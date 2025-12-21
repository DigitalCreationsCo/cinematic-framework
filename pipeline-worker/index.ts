import * as dotenv from "dotenv";
dotenv.config();

import { PubSub } from "@google-cloud/pubsub";
import { PipelineCommand, PipelineEvent } from "../shared/pubsub-types";
import { GraphState, InitialGraphState, Storyboard, LlmRetryInterruptValue } from "../shared/pipeline-types";
import { CinematicVideoWorkflow } from "../pipeline/graph";
import { GCPStorageManager } from "../pipeline/storage-manager";
import { ApiError, Storage } from "@google-cloud/storage";
import { CheckpointerManager } from "../pipeline/checkpointer-manager";
import { RunnableConfig } from "@langchain/core/runnables";
import { AsyncLocalStorage } from "async_hooks";
import { Command } from "@langchain/langgraph";
import { LlmController } from "../pipeline/llm/controller";
import { textModelName, imageModelName } from "../pipeline/llm/google/models";
import { FrameCompositionAgent } from "../pipeline/agents/frame-composition-agent";
import { buildFrameGenerationPrompt } from "../pipeline/prompts/frame-generation-instruction";
import { ContinuityManagerAgent } from "../pipeline/agents/continuity-manager";
import { QualityCheckAgent } from "../pipeline/agents/quality-check-agent";
import { DistributedLockManager } from "../pipeline/utils/lock-manager";
import * as crypto from "crypto";

const projectIdStore = new AsyncLocalStorage<string>();

const gcpProjectId = process.env.GCP_PROJECT_ID;
if (!gcpProjectId) throw Error("A GCP projectId was not provided");

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) throw Error("Postgres URL is required for CheckpointerManager initialization");

const pubsub = new PubSub({
    projectId: gcpProjectId,
    apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
});

const checkpointerManager = new CheckpointerManager(postgresUrl);
await checkpointerManager.init();

const lockManager = new DistributedLockManager(postgresUrl);
await lockManager.init();
const workerId = crypto.randomUUID();

const storage = new Storage({ projectId: gcpProjectId });

const VIDEO_COMMANDS_TOPIC_NAME = "video-commands";
const VIDEO_EVENTS_TOPIC_NAME = "video-events";
const PIPELINE_WORKER_SUBSCRIPTION_NAME = "pipeline-worker-subscription";

const videoEventsTopic = pubsub.topic(VIDEO_EVENTS_TOPIC_NAME);

async function publishPipelineEvent(event: PipelineEvent) {
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await videoEventsTopic.publishMessage({ data: dataBuffer });
}

async function checkAndPublishInterrupt(
    projectId: string,
    compiledGraph: any,
    runnableConfig: RunnableConfig
) {
    try {
        console.log(`[Worker] Checking for interrupts for projectId: ${projectId}`);
        const state = await compiledGraph.getState(runnableConfig);
        console.log(`[Worker] Current state tasks: ${state.tasks?.length || 0}`);

        if (state.tasks && state.tasks.length > 0) {
            const task = state.tasks[ 0 ];
            console.log(`[Worker] Task interrupts: ${task.interrupts?.length || 0}`);

            if (task.interrupts && task.interrupts.length > 0) {
                const interruptValue = task.interrupts[ 0 ].value as LlmRetryInterruptValue;
                console.log(`[Worker] Interrupt value:`, JSON.stringify(interruptValue, null, 2));

                if (interruptValue && (interruptValue.type === 'llm_intervention' || interruptValue.type === 'llm_retry_exhausted')) {
                    console.log(`[Worker] Publishing LLM_INTERVENTION_NEEDED for projectId: ${projectId}`);
                    await publishPipelineEvent({
                        type: "LLM_INTERVENTION_NEEDED",
                        projectId,
                        payload: {
                            error: interruptValue.error,
                            params: interruptValue.params,
                            functionName: interruptValue.functionName
                        },
                        timestamp: new Date().toISOString()
                    });
                    return true;
                }
            }
        }
    } catch (error) {
        console.error("Error checking for interrupts:", error);
    }
    return false;
}

// Only intercept console methods when projectId context exists AND filter out LLM response JSON
function shouldPublishLog(message: any): boolean {
    // Don't publish if message looks like LLM JSON response
    if (typeof message === 'string') {
        const trimmed = message.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                JSON.parse(trimmed);
                return false; // It's valid JSON, likely an LLM response
            } catch {
                // Not valid JSON, safe to publish
            }
        }
    }
    return true;
}

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.log = (message?: any, ...optionalParams: any[]) => {
    originalConsoleLog(message, ...optionalParams);

    const projectId = projectIdStore.getStore();
    if (projectId && shouldPublishLog(message)) {
        const formattedMessage = [ message, ...optionalParams ]
            .map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg))
            .join(' ');

        publishPipelineEvent({
            type: "LOG",
            projectId,
            payload: { level: "info", message: formattedMessage },
            timestamp: new Date().toISOString(),
        }).catch(err => originalConsoleError("Failed to publish log event:", err));
    }
};

console.warn = (message?: any, ...optionalParams: any[]) => {
    originalConsoleLog(message, ...optionalParams);

    const projectId = projectIdStore.getStore();
    if (projectId && shouldPublishLog(message)) {
        const formattedMessage = [ message, ...optionalParams ]
            .map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg))
            .join(' ');

        publishPipelineEvent({
            type: "LOG",
            projectId,
            payload: { level: "warning", message: formattedMessage },
            timestamp: new Date().toISOString(),
        }).catch(err => originalConsoleError("Failed to publish log event:", err));
    }
};

console.error = (message?: any, ...optionalParams: any[]) => {
    originalConsoleLog(message, ...optionalParams);

    const projectId = projectIdStore.getStore();
    if (projectId && shouldPublishLog(message)) {
        const formattedMessage = [ message, ...optionalParams ]
            .map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg))
            .join(' ');

        publishPipelineEvent({
            type: "LOG",
            projectId,
            payload: { level: "error", message: formattedMessage },
            timestamp: new Date().toISOString(),
        }).catch(err => originalConsoleError("Failed to publish log event:", err));
    }
};

async function handleStartPipelineCommand(command: Extract<PipelineCommand, { type: "START_PIPELINE"; }>) {
    const { projectId, payload } = command;

    const bucketName = process.env.GCP_BUCKET_NAME;
    if (!bucketName) {
        throw new Error("GCP_BUCKET_NAME environment variable not set.");
    }

    // Use the projectId as the thread_id for LangGraph checkpointing
    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    const checkpointer = await checkpointerManager.getCheckpointer();
    if (!checkpointer) {
        throw new Error("Checkpointer not initialized");
    }

    let initialState: InitialGraphState;
    const existingCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);

    if (existingCheckpoint) {
        console.log(`[handleStartPipelineCommand] Resuming pipeline for projectId: ${projectId} from checkpoint.`);
        // LangGraph automatically resumes from the checkpoint if initial state is null or empty for stream
        // We still need to construct a workflow to get the compiled graph
        const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
        workflow.publishEvent = publishPipelineEvent;
        const compiledGraph = workflow.graph.compile({ checkpointer });

        try {
            const stream = await compiledGraph.stream(null, { ...runnableConfig, streamMode: [ "values" ] });

            for await (const step of stream) {
                try {
                    console.debug('[handleStartPipelineCommand] stream step');

                    const [ _, state ] = Object.values(step);
                    await publishPipelineEvent({
                        type: "FULL_STATE",
                        projectId,
                        payload: { state: state as GraphState },
                        timestamp: new Date().toISOString(),
                    });

                } catch (error) {
                    console.error('error publishing pipeline event: ');
                    console.error(JSON.stringify(error, null, 2));
                }
            }
        } catch (err) {
            console.error('[handleStartPipelineCommand] Error during stream execution:', err);
        } finally {
            await checkAndPublishInterrupt(projectId, compiledGraph, runnableConfig);
        }
    } else {
        console.log("Starting new pipeline for projectId:", projectId);
        console.log("Initial state for new pipeline:", JSON.stringify(payload, null, 2));

        const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
        let audioPublicUri = payload.audioUrl;
        if (payload.audioUrl && payload.audioUrl.startsWith("gs://")) {
            const sm = new GCPStorageManager(process.env.GCP_PROJECT_ID!, projectId, bucketName);
            audioPublicUri = sm.getPublicUrl(payload.audioUrl);
        }

        initialState = {
            initialPrompt: payload.audioUrl || "",
            creativePrompt: payload.creativePrompt,
            audioGcsUri: payload.audioUrl, // Assuming audioUrl is the GCS URI
            audioPublicUri: audioPublicUri,
            hasAudio: !!payload.audioUrl,
            currentSceneIndex: 0,
            errors: [],
            generationRules: [],
            refinedRules: [],
            attempts: {},
        };
        workflow.publishEvent = publishPipelineEvent;
        const compiledGraph = workflow.graph.compile({ checkpointer });
        console.log(`Compiled graph for new pipeline for projectId: ${projectId}. Starting stream.`);

        try {
            const stream = await compiledGraph.stream(initialState, { ...runnableConfig, streamMode: [ "values" ] });

            for await (const step of stream) {
                try {
                    console.debug('[handleStartPipelineCommand] stream step');

                    const [ _, state ] = Object.values(step);
                    await publishPipelineEvent({
                        type: "FULL_STATE",
                        projectId,
                        payload: { state: state as GraphState },
                        timestamp: new Date().toISOString(),
                    });
                } catch (error) {
                    console.error('error publishing pipeline event for new pipeline: ');
                    console.error(JSON.stringify(error, null, 2));
                }
            }
        } catch (err) {
            console.error('[handleStartPipelineCommand] Error during new pipeline stream execution:', err);
        } finally {
            await checkAndPublishInterrupt(projectId, compiledGraph, runnableConfig);
        }
    }
}

async function handleRequestFullStateCommand(command: Extract<PipelineCommand, { type: "REQUEST_FULL_STATE"; }>) {
    const { projectId } = command;
    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    try {
        const existingCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);
        if (existingCheckpoint && existingCheckpoint.channel_values) {
            await publishPipelineEvent({
                type: "FULL_STATE",
                projectId,
                payload: { state: existingCheckpoint.channel_values as GraphState },
                timestamp: new Date().toISOString(),
            });
        } else {
            console.warn(`No checkpoint found for projectId: ${projectId}`);
            console.warn(`Retrieveing recent state from storage`);

            const bucketName = process.env.GCP_BUCKET_NAME;
            if (!bucketName) {
                throw new Error("GCP_BUCKET_NAME environment variable not set.");
            }

            const storyboardPath = `${projectId}/scenes/storyboard.json`;
            const [ contents ] = await storage.bucket(bucketName).file(storyboardPath).download();
            if (contents.length) {
                const storyboard = JSON.parse(contents.toString());

                console.log("   Found existing storyboard. Resuming workflow.");

                const state: GraphState = {
                    initialPrompt: "",
                    creativePrompt: "",
                    hasAudio: false,
                    storyboard,
                    storyboardState: storyboard,
                    currentSceneIndex: 0,
                    audioGcsUri: "",
                    errors: [],
                    generationRules: [],
                    refinedRules: [],
                    attempts: {},
                };

                await publishPipelineEvent({
                    type: "FULL_STATE",
                    projectId,
                    payload: { state: state as GraphState },
                    timestamp: new Date().toISOString(),
                });

            } else {
                console.warn(`No state found in storage. ProjectId: ${projectId}`);
            }
        }

        if (existingCheckpoint) {
            const bucketName = process.env.GCP_BUCKET_NAME || 'default-bucket';
            const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
            const checkpointer = await checkpointerManager.getCheckpointer();
            if (checkpointer) {
                const compiledGraph = workflow.graph.compile({ checkpointer });
                await checkAndPublishInterrupt(projectId, compiledGraph, runnableConfig);
            }
        }

    } catch (error) {
        console.error("Error handling REQUEST_FULL_STATE:", error);
    }
}

async function handleResumePipelineCommand(command: Extract<PipelineCommand, { type: "RESUME_PIPELINE"; }>) {
    const { projectId } = command;
    console.log(`[handleResumePipelineCommand] Resuming pipeline for projectId: ${projectId}`);

    const bucketName = process.env.GCP_BUCKET_NAME;
    if (!bucketName) {
        throw new Error("GCP_BUCKET_NAME environment variable not set.");
    }

    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    const checkpointer = await checkpointerManager.getCheckpointer();
    if (!checkpointer) {
        throw new Error("Checkpointer not initialized");
    }

    const existingCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);
    if (!existingCheckpoint) {
        console.warn(`No checkpoint found to resume for projectId: ${projectId}`);
        // Optionally send a FAILURE event back to client
        await publishPipelineEvent({
            type: "WORKFLOW_FAILED",
            projectId,
            payload: { error: "No existing pipeline found to resume." },
            timestamp: new Date().toISOString(),
        });
        return;
    }

    const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
    workflow.publishEvent = publishPipelineEvent;
    const compiledGraph = workflow.graph.compile({ checkpointer });

    console.log(`Pipeline for projectId: ${projectId} resuming.`);

    try {
        const stream = await compiledGraph.stream(null, { ...runnableConfig, streamMode: [ "values" ] });

        for await (const step of stream) {
            console.debug('[handleResumePipelineCommand] stream step');
            const [ _, state ] = Object.values(step);

            await publishPipelineEvent({
                type: "FULL_STATE",
                projectId,
                payload: { state: state as GraphState },
                timestamp: new Date().toISOString(),
            });
        }
    } catch (err) {
        console.error('[handleResumePipelineCommand] Error during stream execution:', err);
    } finally {
        await checkAndPublishInterrupt(projectId, compiledGraph, runnableConfig);
    }
}

async function handleRegenerateSceneCommand(command: Extract<PipelineCommand, { type: "REGENERATE_SCENE"; }>) {
    const { projectId, payload } = command;
    console.log(`Regenerating scene ${payload.sceneId} for projectId: ${projectId}`);

    const bucketName = process.env.GCP_BUCKET_NAME;
    if (!bucketName) {
        throw new Error("GCP_BUCKET_NAME environment variable not set.");
    }

    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    const checkpointer = await checkpointerManager.getCheckpointer();
    if (!checkpointer) {
        throw new Error("Checkpointer not initialized");
    }

    const existingCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);
    if (!existingCheckpoint) {
        console.warn(`No checkpoint found to regenerate scene for projectId: ${projectId}`);
        return;
    }

    await publishPipelineEvent({
        type: "SCENE_STARTED",
        projectId,
        payload: {
            sceneId: payload.sceneId,
            sceneIndex: -1, // Unknown during regeneration
            totalScenes: -1
        },
        timestamp: new Date().toISOString(),
    });

    let currentState = existingCheckpoint.channel_values as GraphState;
    const sceneId = payload.sceneId;

    const sceneIndexToRetry = currentState.storyboardState?.scenes.findIndex(s => s.id === sceneId);

    if (sceneIndexToRetry !== undefined && sceneIndexToRetry !== -1) {
        // Prepare overrides
        const promptOverrides = currentState.scenePromptOverrides || {};
        if (payload.promptModification) {
            promptOverrides[ sceneId ] = payload.promptModification;
        }

        currentState = {
            ...currentState,
            currentSceneIndex: sceneIndexToRetry,
            forceRegenerateSceneId: payload.forceRegenerate ? sceneId : undefined,
            scenePromptOverrides: promptOverrides,
            // We do NOT clear generatedVideo here, because process_scene logic handles skipping based on existence
            // UNLESS forceRegenerateSceneId matches.
            // If we want to support "soft" regeneration (only if missing), we wouldn't set forceRegenerateSceneId.
            // But REGENERATE_SCENE implies intention to re-do it.
        };
        runnableConfig.configurable = { ...runnableConfig.configurable, ...currentState };

        const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
        workflow.publishEvent = publishPipelineEvent;

        await checkpointer.put(runnableConfig, existingCheckpoint, {} as any, {});
        const compiledGraph = workflow.graph.compile({ checkpointer });

        console.log(`Pipeline for projectId: ${projectId} restarting from scene ${sceneId} with forceRegenerate=${payload.forceRegenerate}`);

        try {
            const stream = await compiledGraph.stream(
                new Command({
                    goto: "process_scene" as any,
                    update: currentState
                }),
                { ...runnableConfig, streamMode: [ "values" ] }
            );

            for await (const step of stream) {
                try {
                    console.debug(`[RegenerateScene] Processing step for scene ${payload.sceneId}`);

                    const [ _, state ] = Object.values(step);
                    await publishPipelineEvent({
                        type: "FULL_STATE",
                        projectId,
                        payload: { state: state as GraphState },
                        timestamp: new Date().toISOString(),
                    });
                } catch (error) {
                    console.error('Error publishing during regeneration:', error);
                }
            }

            await publishPipelineEvent({
                type: "SCENE_COMPLETED",
                projectId,
                payload: {
                    sceneId: payload.sceneId,
                    sceneIndex: sceneIndexToRetry,
                    videoUrl: "" // Will be in FULL_STATE
                },
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            console.error('[handleRegenerateSceneCommand] Error during stream execution:', err);
        } finally {
            await checkAndPublishInterrupt(projectId, compiledGraph, runnableConfig);
        }
    } else {
        console.warn(`Scene ${sceneId} not found in pipeline for projectId: ${projectId}`);
        await publishPipelineEvent({
            type: "WORKFLOW_FAILED",
            projectId,
            payload: { error: `Scene ${sceneId} not found.` },
            timestamp: new Date().toISOString(),
        });
    }
}

async function handleRegenerateFrameCommand(command: Extract<PipelineCommand, { type: "REGENERATE_FRAME"; }>) {
    const { projectId, payload } = command;
    const { sceneId, frameType, promptModification } = payload;
    console.log(`Regenerating ${frameType} frame for scene ${sceneId} for projectId: ${projectId}`);

    if (!gcpProjectId) throw new Error("GCP_PROJECT_ID environment variable not set.");

    if (!projectId) throw Error("A projectId was not provided");

    const bucketName = process.env.GCP_BUCKET_NAME;
    if (!bucketName) {
        throw new Error("GCP_BUCKET_NAME environment variable not set.");
    }

    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    const existingCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);
    if (!existingCheckpoint) {
        console.warn(`No checkpoint found to regenerate frame for projectId: ${projectId}`);
        return;
    }

    const currentState = existingCheckpoint.channel_values as GraphState;
    const scene = currentState.storyboardState?.scenes.find(s => s.id === sceneId);
    if (!scene) {
        console.error(`Scene ${sceneId} not found in state.`);
        return;
    }

    // --- State and Agent Initialization ---
    const storageManager = new GCPStorageManager(gcpProjectId, projectId, bucketName);
    const textLlm = new LlmController();
    const imageLlm = new LlmController();
    const qualityAgent = new QualityCheckAgent(textLlm, storageManager);
    const frameComposer = new FrameCompositionAgent(imageLlm, qualityAgent, storageManager);
    const continuityManager = new ContinuityManagerAgent(textLlm, imageLlm, frameComposer, qualityAgent, storageManager);


    const sceneCharacters = currentState.storyboardState!.characters.filter(char => scene.characters.includes(char.id));
    const sceneLocation = currentState.storyboardState!.locations.find(loc => scene.locationId.includes(loc.id));

    if (!sceneLocation) {
        console.error(`Location ${scene.locationId} not found in state.`);
        return;
    }

    const previousSceneIndex = currentState.storyboardState!.scenes.findIndex(s => s.id === scene.id) - 1;
    const previousScene = previousSceneIndex >= 0 ? currentState.storyboardState!.scenes[ previousSceneIndex ] : undefined;


    console.log(`  → Regenerating ${frameType} frame for Scene ${scene.id}...`);

    const newFrame = await frameComposer.generateImage(
        scene,
        promptModification,
        frameType,
        sceneCharacters,
        [ sceneLocation ],
        frameType === 'start' ? previousScene?.endFrame : scene.startFrame,
        [
            ...sceneCharacters.flatMap(c => c.referenceImages || []),
            ...(sceneLocation.referenceImages || []),
        ]
    );

    // --- Update State ---
    const updatedScenes = currentState.storyboardState!.scenes.map(s => {
        if (s.id === sceneId) {
            return {
                ...s,
                [ frameType === 'start' ? 'startFrame' : 'endFrame' ]: newFrame,
                [ frameType === 'start' ? 'startFramePrompt' : 'endFramePrompt' ]: promptModification,
            };
        }
        return s;
    });

    const newState: GraphState = {
        ...currentState,
        storyboardState: {
            ...currentState.storyboardState!,
            scenes: updatedScenes,
        },
    };

    // --- Save Checkpoint and Publish ---
    const checkpointer = await checkpointerManager.getCheckpointer();
    if (!checkpointer) {
        throw new Error("Checkpointer not initialized");
    }
    await checkpointer.put(runnableConfig, {
        ...existingCheckpoint,
        channel_values: newState
    }, {} as any, {});


    await publishPipelineEvent({
        type: "FULL_STATE",
        projectId,
        payload: { state: newState },
        timestamp: new Date().toISOString(),
    });

    console.log(`✓ Successfully regenerated and updated ${frameType} frame for scene ${sceneId}.`);
}

async function handleResolveInterventionCommand(command: Extract<PipelineCommand, { type: "RESOLVE_INTERVENTION"; }>) {
    const { projectId, payload } = command;
    console.log(`Resolving intervention for projectId: ${projectId}`, payload);

    const bucketName = process.env.GCP_BUCKET_NAME;
    if (!bucketName) {
        throw new Error("GCP_BUCKET_NAME environment variable not set.");
    }

    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    const checkpointer = await checkpointerManager.getCheckpointer();
    if (!checkpointer) {
        throw new Error("Checkpointer not initialized");
    }

    const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
    workflow.publishEvent = publishPipelineEvent;
    const compiledGraph = workflow.graph.compile({ checkpointer });

    console.log(`Resuming graph for projectId: ${projectId} with action: ${payload.action}`);

    try {
        const stream = await compiledGraph.stream(
            new Command({
                resume: {
                    action: payload.action,
                    revisedParams: payload.revisedParams
                }
            }),
            { ...runnableConfig, streamMode: [ "values" ] }
        );

        for await (const step of stream) {
            try {
                console.debug(`[ResolveIntervention] Processing step`);
                const [ _, state ] = Object.values(step);
                await publishPipelineEvent({
                    type: "FULL_STATE",
                    projectId,
                    payload: { state: state as GraphState },
                    timestamp: new Date().toISOString(),
                });
            } catch (error) {
                console.error('Error publishing during intervention resolution:', error);
            }
        }

        await checkAndPublishInterrupt(projectId, compiledGraph, runnableConfig);
    } catch (error) {
        console.error("Error resuming graph:", error);

        // Check for interrupt before failing
        const isInterrupt = await checkAndPublishInterrupt(projectId, compiledGraph, runnableConfig);
        if (isInterrupt) {
            return;
        }

        await publishPipelineEvent({
            type: "WORKFLOW_FAILED",
            projectId,
            payload: { error: `Failed to resume workflow: ${error}` },
            timestamp: new Date().toISOString(),
        });
    }
}

async function handleStopPipelineCommand(command: Extract<PipelineCommand, { type: "STOP_PIPELINE"; }>) {
    const { projectId } = command;
    console.log(`Stopping pipeline for projectId: ${projectId}`);

    // For now, stopping means saving the current state (if any) and effectively ending the process's management of it.
    // We'll rely on the streaming loop to gracefully complete/checkpoint the last known state.

    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    const currentCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);
    if (currentCheckpoint) {
        await checkpointerManager.saveCheckpoint(runnableConfig, currentCheckpoint);
        console.log(`Pipeline for ${projectId} stopped and state checkpointed.`);
    } else {
        console.warn(`No active pipeline or checkpoint found to stop for projectId: ${projectId}`);
    }
}


async function main() {
    console.log("Starting pipeline worker...");

    checkpointerManager.getCheckpointer();

    const [ videoCommandsTopic ] = await pubsub.topic(VIDEO_COMMANDS_TOPIC_NAME).get({ autoCreate: true });
    await pubsub.topic(VIDEO_EVENTS_TOPIC_NAME).get({ autoCreate: true });
    await videoCommandsTopic.subscription(PIPELINE_WORKER_SUBSCRIPTION_NAME).get({ autoCreate: true });

    const pipelineCommandsSubscription = pubsub.subscription(PIPELINE_WORKER_SUBSCRIPTION_NAME);
    console.log(`Listening for commands on ${PIPELINE_WORKER_SUBSCRIPTION_NAME}...`);

    pipelineCommandsSubscription.on("message", async (message) => {
        let command: PipelineCommand | undefined;

        try {
            command = JSON.parse(message.data.toString()) as PipelineCommand;
        } catch (error) {
            console.error("Error parsing command:", error);
            message.ack(); // Ack invalid JSON to remove it from queue
            return;
        }

        console.log(`[Worker] Received command: ${command.type} for projectId: ${command.projectId} (Msg ID: ${message.id}, Attempt: ${message.deliveryAttempt})`);

        // Acquire lock
        const acquired = await lockManager.tryAcquire(command.projectId, workerId);
        if (!acquired) {
            console.warn(`[Worker] Could not acquire lock for project ${command.projectId}. It may be processing on another worker.`);
            message.ack(); // Ack to remove from queue (or nack to retry later if you prefer)
            return;
        }

        // Heartbeat loop
        const heartbeat = setInterval(() => {
            lockManager.refresh(command!.projectId, workerId).catch(err => console.error(`[Worker] Heartbeat failed for ${command!.projectId}:`, err));
        }, 30000);

        // Acknowledge immediately to prevent Pub/Sub redelivery during long-running tasks
        // Note: In distributed setup, if we crash, the lock expires and pubsub (if nacked or not acked) would redeliver.
        // But here we ACK immediately. If we crash, the message is lost from PubSub.
        // For reliability, we should only ACK after completion, but PubSub has ack deadlines (max 10 mins).
        // Long running tasks usually require acking and using separate persistence (which we have in Postgres).
        message.ack();

        try {
            await projectIdStore.run(command.projectId, async () => {
                switch (command!.type) {
                    case "START_PIPELINE":
                        await handleStartPipelineCommand(command as Extract<PipelineCommand, { type: "START_PIPELINE"; }>);
                        break;
                    case "REQUEST_FULL_STATE":
                        await handleRequestFullStateCommand(command as Extract<PipelineCommand, { type: "REQUEST_FULL_STATE"; }>);
                        break;
                    case "RESUME_PIPELINE":
                        await handleResumePipelineCommand(command as Extract<PipelineCommand, { type: "RESUME_PIPELINE"; }>);
                        break;
                    case "REGENERATE_SCENE":
                        await handleRegenerateSceneCommand(command as Extract<PipelineCommand, { type: "REGENERATE_SCENE"; }>);
                        break;
                    case "REGENERATE_FRAME":
                        await handleRegenerateFrameCommand(command as Extract<PipelineCommand, { type: "REGENERATE_FRAME"; }>);
                        break;
                    case "RESOLVE_INTERVENTION":
                        await handleResolveInterventionCommand(command as Extract<PipelineCommand, { type: "RESOLVE_INTERVENTION"; }>);
                        break;
                    case "STOP_PIPELINE":
                        await handleStopPipelineCommand(command as Extract<PipelineCommand, { type: "STOP_PIPELINE"; }>);
                        break;
                }
            });
        } catch (error) {
            console.error(`[Worker] Error processing command for project ${command.projectId}:`, error);
            if (error instanceof ApiError) {
                pipelineCommandsSubscription.close();
                process.exit(1);
            }
        } finally {
            clearInterval(heartbeat);
            await lockManager.release(command.projectId, workerId);
        }
    });

    process.on("SIGINT", () => {
        console.log("Shutting down worker...");
        pipelineCommandsSubscription.close();
        process.exit(0);
    });
}

main().catch(console.error);
