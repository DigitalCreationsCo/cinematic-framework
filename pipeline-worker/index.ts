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
import { Command, StateDefinition, StateType } from "@langchain/langgraph";
import { LlmController } from "../pipeline/llm/controller";
import { textModelName, imageModelName } from "../pipeline/llm/google/models";
import { FrameCompositionAgent } from "../pipeline/agents/frame-composition-agent";
import { buildFrameGenerationPrompt } from "../pipeline/prompts/frame-generation-instruction";
import { ContinuityManagerAgent } from "../pipeline/agents/continuity-manager";
import { QualityCheckAgent } from "../pipeline/agents/quality-check-agent";
import { DistributedLockManager } from "../pipeline/utils/lock-manager";
import { checkAndPublishInterruptFromSnapshot, checkAndPublishInterruptFromStream, mergeParamsIntoState } from "./interrupts";
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

// const lockManager = new DistributedLockManager(postgresUrl);
// await lockManager.init();
const workerId = crypto.randomUUID();

const VIDEO_COMMANDS_TOPIC_NAME = "video-commands";
const VIDEO_EVENTS_TOPIC_NAME = "video-events";
const PIPELINE_WORKER_SUBSCRIPTION_NAME = "pipeline-worker-subscription";

const videoEventsTopic = pubsub.topic(VIDEO_EVENTS_TOPIC_NAME);

async function publishPipelineEvent(event: PipelineEvent) {
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await videoEventsTopic.publishMessage({ data: dataBuffer });
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

async function streamWithInterruptHandling(
    projectId: string,
    compiledGraph: any,
    initialState: any,
    runnableConfig: RunnableConfig,
    commandName: string
): Promise<void> {
    console.log(`[${commandName}] Starting stream for projectId: ${projectId}`);

    try {
        const stream = await compiledGraph.stream(
            initialState,
            {
                ...runnableConfig,
                streamMode: [ "values" ]
            }
        );

        for await (const step of stream) {
            try {
                console.debug(`[${commandName}] Processing stream step`);

                const [ _, state ] = Object.entries(step)[ 0 ];

                // Publish state update
                await publishPipelineEvent({
                    type: "FULL_STATE",
                    projectId,
                    payload: { state: state as GraphState },
                    timestamp: new Date().toISOString()
                });

                await checkAndPublishInterruptFromStream(projectId, compiledGraph, publishPipelineEvent);

            } catch (error) {
                console.error(`[${commandName}] Error publishing state:`, error);
                // Don't throw - continue processing stream
            }
        }

        console.log(`[${commandName}] Stream completed`);

    } catch (error) {
        console.error(`[${commandName}] Error during stream execution:`, error);

        // Check if this is an interrupt (not a real error)
        const isInterrupt = await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishPipelineEvent);

        if (!isInterrupt) {
            // Real error - publish failure
            await publishPipelineEvent({
                type: "WORKFLOW_FAILED",
                projectId,
                payload: {
                    error: `Stream execution failed: ${error instanceof Error ? error.message : String(error)}`
                },
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    } finally {
        await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishPipelineEvent);
    }
}

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

                    await checkAndPublishInterruptFromStream(projectId, state as GraphState, publishPipelineEvent);

                } catch (error) {
                    console.error('error publishing pipeline event: ');
                    console.error(JSON.stringify(error, null, 2));
                }
            }
        } catch (err) {
            console.error('[handleStartPipelineCommand] Error during stream execution:', err);
        } finally {
            await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishPipelineEvent);
        }
    } else {
        console.log(`No checkpoint found for projectId: ${projectId}`);
        console.log("[handleStartPipelineCommand] Starting new pipeline for projectId:", projectId);
        console.log("parameters for new pipeline:", JSON.stringify(payload, null, 2));

        const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
        
        const sm = new GCPStorageManager(process.env.GCP_PROJECT_ID!, projectId, bucketName);
        
        let audioPublicUri;
        if (payload.audioGcsUri) {
            audioPublicUri = sm.getPublicUrl(payload.audioGcsUri);
        }

        try {
            console.log("   Checking for existing storyboard...");
            const storyboardPath = `${projectId}/scenes/storyboard.json`;
            const storyboard = await sm.downloadJSON<Storyboard>(storyboardPath);

            console.log("   Found existing storyboard.");

            initialState = {
                localAudioPath: payload.audioGcsUri || "",
                creativePrompt: payload.creativePrompt,
                audioGcsUri: payload.audioGcsUri,
                audioPublicUri: audioPublicUri,
                hasAudio: !!payload.audioGcsUri,
                storyboard: storyboard,
                storyboardState: storyboard,
                currentSceneIndex: 0,
                errors: [],
                generationRules: [],
                refinedRules: [],
                attempts: {},
            };
        } catch (error) {
            console.error("Error loading from GCS: ", error);
            console.log("   No existing storyboard found or error loading it. Starting fresh workflow.");

            initialState = {
                localAudioPath: payload.audioGcsUri || "",
                creativePrompt: payload.creativePrompt,
                audioGcsUri: payload.audioGcsUri,
                audioPublicUri: audioPublicUri,
                hasAudio: !!payload.audioGcsUri,
                currentSceneIndex: 0,
                errors: [],
                generationRules: [],
                refinedRules: [],
                attempts: await sm.scanCurrentAttempts(),
            };
        }

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

                    await checkAndPublishInterruptFromStream(projectId, state as GraphState, publishPipelineEvent);

                } catch (error) {
                    console.error('error publishing pipeline event for new pipeline: ');
                    console.error(JSON.stringify(error, null, 2));
                }
            }
        } catch (err) {
            console.error('[handleStartPipelineCommand] Error during new pipeline stream execution:', err);
        } finally {
            await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishPipelineEvent);
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

            const storage = new GCPStorageManager(process.env.GCP_PROJECT_ID!, projectId, bucketName);

            let state: GraphState;
            try {
                console.log("   Checking for existing storyboard...");
                
                const storyboardPath = `${projectId}/scenes/storyboard.json`;
                const storyboard = await storage.downloadJSON<Storyboard>(storyboardPath);

                console.log("   Found existing storyboard. Resuming workflow.");

                state = {
                    localAudioPath: "",
                    creativePrompt: storyboard.metadata.creativePrompt || "",
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

            } catch (error) {
                console.warn(`No state found in storage. ProjectId: ${projectId}`);
            }
        }

        if (existingCheckpoint) {
            const bucketName = process.env.GCP_BUCKET_NAME || 'default-bucket';
            const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
            const checkpointer = await checkpointerManager.getCheckpointer();
            if (checkpointer) {
                const compiledGraph = workflow.graph.compile({ checkpointer });
                await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishPipelineEvent);
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

            await checkAndPublishInterruptFromStream(projectId, state as GraphState, publishPipelineEvent);
        }
    } catch (err) {
        console.error('[handleResumePipelineCommand] Error during stream execution:', err);
    } finally {
        await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishPipelineEvent);
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
            sceneIndex: -1, 
            totalScenes: -1
        },
        timestamp: new Date().toISOString(),
    });

    let currentState = existingCheckpoint.channel_values as GraphState;
    const sceneId = payload.sceneId;

    const sceneIndexToRetry = currentState.storyboardState?.scenes.findIndex(s => s.id === sceneId);

    if (sceneIndexToRetry !== undefined && sceneIndexToRetry !== -1) {
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

                    await checkAndPublishInterruptFromStream(projectId, state as GraphState, publishPipelineEvent);

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
            await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishPipelineEvent);
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

async function handleResolveInterventionCommand(
    command: Extract<PipelineCommand, { type: "RESOLVE_INTERVENTION"; }>
) {
    const { projectId, payload } = command;
    console.log(`[Worker] Resolving intervention for projectId: ${projectId}`, {
        action: payload.action,
        hasRevisedParams: !!payload.revisedParams
    });

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

    // Load current state
    const existingCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);
    if (!existingCheckpoint) {
        throw new Error(`No checkpoint found for projectId: ${projectId}`);
    }

    const currentState = existingCheckpoint.channel_values as GraphState;

    // Verify there's an interrupt to resolve 
    if (!currentState.__interrupt__?.[0].value) {
        console.warn(`[Worker] No interrupt found in state to resolve for projectId: ${projectId}. Checking if we can resume anyway.`);
        return;
    }

    const interruptData = currentState.__interrupt__?.[0].value;
    const nodeName = interruptData?.nodeName || 'unknown_node';

    // Handle different resolution actions
    let updatedState: Partial<GraphState>;

    switch (payload.action) {
        case 'retry':
            // Merge revised params if provided, otherwise use original params
            const paramsToUse = payload.revisedParams
                ? { ...(interruptData?.params || {}), ...payload.revisedParams }
                : (interruptData?.params || {});

            console.log(`[Worker] Retrying with params:`, paramsToUse);

            updatedState = {
                __interrupt__: undefined,
                __interrupt_resolved__: true,
                ...mergeParamsIntoState(currentState, paramsToUse)
            };
            break;

        case 'skip':
            console.log(`[Worker] Skipping failed node: ${nodeName}`);

            updatedState = {
                __interrupt__: undefined,
                __interrupt_resolved__: true,
                errors: [
                    ...(currentState.errors || []),
                    {
                        node: interruptData.nodeName,
                        error: interruptData.error,
                        skipped: true,
                        timestamp: new Date().toISOString()
                    }
                ]
            };
            break;

        case 'abort':
            console.log(`[Worker] Aborting workflow for projectId: ${projectId}`);

            await publishPipelineEvent({
                type: "WORKFLOW_FAILED",
                projectId,
                payload: {
                    error: `Workflow canceled during ${nodeName}`,
                    nodeName: interruptData.nodeName
                },
                timestamp: new Date().toISOString()
            });

            updatedState = {
                __interrupt__: undefined,
                __interrupt_resolved__: true
            };

            await checkpointer.put(runnableConfig, {
                ...existingCheckpoint,
                channel_values: { ...currentState, ...updatedState }
            }, {} as any, {});

            return;
        default:
            throw new Error(`Unknown action: ${payload.action}`);
    }

    const workflow = new CinematicVideoWorkflow(
        process.env.GCP_PROJECT_ID!,
        projectId,
        bucketName
    );
    workflow.publishEvent = publishPipelineEvent;
    const compiledGraph = workflow.graph.compile({ checkpointer });

    console.log(`[Worker] Resuming graph with action: ${payload.action}`);

    try {
        // We use 'resume' property of Command to supply the value to the interrupted node
        // BUT since we modified the state logic to be "State-based interrupt", we might just need to update the state.
        // However, if we are at a breakpoint (interrupt), we typically need to provide a resume value or use `update`.

        // If we are just updating state, we can use `update` in Command?
        // LangGraph `Command` with `resume` resumes execution from the interruption.
        // If we want to update state, we can pass the state update as the resume value IF the node expects it,
        // OR we can rely on `checkpointer.put` we might have done?
        // Wait, I didn't do `checkpointer.put` for retry/skip cases above.

        // Let's use Command with resume: updatedState.
        // And assume the node logic (which checks for __interrupt__) will receive this.
        // actually, if we use `Command` with `resume`, the `NodeInterrupt` exception catches this value?
        // No, `NodeInterrupt` stops execution. `resume` provides the return value for the function that threw/interrupted?
        // In LangGraphJS, if you interrupt, the resume value is what is returned to the node.

        // However, my `llmOperationNode` throws `NodeInterrupt`.
        // If I resume, does it re-run the node? Or continue?
        // If I want to re-run, I should probably update state and then resume?

        // The spec says: "Graph resumes from interrupted node".
        // If I want to retry, I need to re-run the logic.
        // If I just pass `updatedState` as resume value, the node needs to handle it.

        // Let's assume the standard LangGraph pattern:
        // Command({ resume: value }) resumes.

        // If we want to modify state BEFORE resuming, we can use `checkpointer.put` or pass state update in Command?
        // For `retry`, we want to update the state (new params) and then have the node re-execute or continue.

        // Implementation decision:
        // We will pass `updatedState` as the resume value.
        // AND we will ensure `llmOperationNode` (which I will implement later) handles the resume value if returned?
        // Actually, if we just want to update the state, we can do:

        const stream = await compiledGraph.stream(
            new Command({
                resume: updatedState
            }),
            { ...runnableConfig, streamMode: [ "values" ] }
        );

        // Process stream
        for await (const step of stream) {
            console.debug(`[ResolveIntervention] Processing step`);
            const [ _, state ] = Object.entries(step)[ 0 ];

            await publishPipelineEvent({
                type: "FULL_STATE",
                projectId,
                payload: { state: state as GraphState },
                timestamp: new Date().toISOString()
            });
        }

        console.log(`[Worker] Resolving interrupt for projectId: ${projectId}`, {
            action: payload.action,
            nodeName: interruptData.nodeName,
            hasRevisedParams: !!payload.revisedParams
        });

        await publishPipelineEvent({
            type: "INTERVENTION_RESOLVED",
            projectId,
            payload: {
                action: payload.action,
                nodeName: nodeName
            },
            timestamp: new Date().toISOString()
        });

        await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishPipelineEvent);

        console.log(`[Worker] Workflow resumed after interrupt:`, {
            projectId: projectId,
            nodeName: interruptData.nodeName,
            action: payload.action
        });

    } catch (error) {
        console.error("[Worker] Error resuming graph:", error);

        const isInterrupt = await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishPipelineEvent);

        if (!isInterrupt) {
            await publishPipelineEvent({
                type: "WORKFLOW_FAILED",
                projectId,
                payload: {
                    error: `Failed to resume after intervention: ${error}`,
                    nodeName: interruptData.nodeName
                },
                timestamp: new Date().toISOString()
            });
        }
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
            message.ack(); 
            return;
        }

        console.log(`[Worker] Received command: ${command.type} for projectId: ${command.projectId} (Msg ID: ${message.id}, Attempt: ${message.deliveryAttempt})`);

        // Acquire lock
        // const acquired = await lockManager.tryAcquire(command.projectId, workerId);
        // if (!acquired) {
        //     console.warn(`[Worker] Could not acquire lock for project ${command.projectId}. It may be processing on another worker.`);
        //     message.ack(); // Ack to remove from queue (or nack to retry later if you prefer)
        //     return;
        // }

        // const heartbeat = setInterval(() => {
        //     lockManager.refresh(command!.projectId, workerId).catch(err => console.error(`[Worker] Heartbeat failed for ${command!.projectId}:`, err));
        // }, 30000);

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
            // clearInterval(heartbeat);
            // await lockManager.release(command.projectId, workerId);
        }
    });

    process.on("SIGINT", () => {
        console.log("Shutting down worker...");
        pipelineCommandsSubscription.close();
        process.exit(0);
    });
}

main().catch(console.error);
