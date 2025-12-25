import { PipelineEvent } from "../shared/pubsub-types";
import { GraphState, InitialGraphState } from "../shared/pipeline-types";
import { CinematicVideoWorkflow } from "../pipeline/graph";
import { CheckpointerManager } from "../pipeline/checkpointer-manager";
import { RunnableConfig } from "@langchain/core/runnables";
import { Command, CompiledStateGraph } from "@langchain/langgraph";
import { streamWithInterruptHandling } from "./helpers/stream-helper";
import { mergeParamsIntoState, checkAndPublishInterruptFromSnapshot } from "./helpers/interrupts";
import { GCPStorageManager } from "../pipeline/storage-manager";
import { LlmController } from "../pipeline/llm/controller";
import { QualityCheckAgent } from "../pipeline/agents/quality-check-agent";
import { FrameCompositionAgent } from "../pipeline/agents/frame-composition-agent";
import { ContinuityManagerAgent } from "../pipeline/agents/continuity-manager";

export class WorkflowService {
    private checkpointerManager: CheckpointerManager;
    private publishEvent: (event: PipelineEvent) => Promise<void>;
    private activeControllers: Map<string, AbortController> = new Map();
    private gcpProjectId: string;
    private bucketName: string;

    constructor(
        checkpointerManager: CheckpointerManager,
        publishEvent: (event: PipelineEvent) => Promise<void>,
        gcpProjectId?: string,
        bucketName?: string
    ) {
        this.checkpointerManager = checkpointerManager;
        this.publishEvent = publishEvent;
        this.gcpProjectId = gcpProjectId || process.env.GCP_PROJECT_ID!;
        this.bucketName = bucketName || process.env.GCP_BUCKET_NAME!;

        if (!this.bucketName) {
            throw new Error("GCP_BUCKET_NAME environment variable not set.");
        }
    }

    private getWorkflowInstance(projectId: string): CinematicVideoWorkflow {
        const workflow = new CinematicVideoWorkflow(this.gcpProjectId, projectId, this.bucketName);
        workflow.publishEvent = this.publishEvent;
        return workflow;
    }

    private async getCompiledGraph(projectId: string): Promise<CompiledStateGraph<GraphState, Partial<GraphState>, string>> {
        const workflow = this.getWorkflowInstance(projectId);
        const checkpointer = await this.checkpointerManager.getCheckpointer();
        if (!checkpointer) {
            throw new Error("Checkpointer not initialized");
        }
        return workflow.graph.compile({ checkpointer });
    }

    private getRunnableConfig(projectId: string): RunnableConfig {
        // Create or get AbortController for this project
        let controller = this.activeControllers.get(projectId);
        if (!controller || controller.signal.aborted) {
            controller = new AbortController();
            this.activeControllers.set(projectId, controller);
        }

        return {
            configurable: { thread_id: projectId },
            signal: controller.signal
        };
    }

    public async stopPipeline(projectId: string) {
        console.log(`[WorkflowService] Stopping pipeline for ${projectId}`);
        const controller = this.activeControllers.get(projectId);
        if (controller) {
            controller.abort();
            this.activeControllers.delete(projectId);
            console.log(`[WorkflowService] Aborted controller for ${projectId}`);
        } else {
            console.warn(`[WorkflowService] No active controller found for ${projectId} to stop.`);
        }
    }

    async startPipeline(projectId: string, payload: any) {
        const config = this.getRunnableConfig(projectId);
        const compiledGraph = await this.getCompiledGraph(projectId);
        const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);

        if (existingCheckpoint) {
            console.log(`[WorkflowService] Resuming existing checkpoint for ${projectId}`);
            await streamWithInterruptHandling(projectId, compiledGraph, null, config, "startPipeline", this.publishEvent);
        } else {
            console.log(`[WorkflowService] Starting new pipeline for ${projectId}`);
            const initialState = await this.buildInitialState(projectId, payload);
            await streamWithInterruptHandling(projectId, compiledGraph, initialState, config, "startPipeline", this.publishEvent);
        }
    }

    async resumePipeline(projectId: string) {
        const config = this.getRunnableConfig(projectId);
        const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);

        if (!existingCheckpoint) {
            console.warn(`[WorkflowService] No checkpoint found to resume for ${projectId}`);
            await this.publishEvent({
                type: "WORKFLOW_FAILED",
                projectId: projectId,
                payload: { error: "No existing pipeline found to resume." },
                timestamp: new Date().toISOString(),
            });
            return;
        }

        const compiledGraph = await this.getCompiledGraph(projectId);
        await streamWithInterruptHandling(projectId, compiledGraph, null, config, "resumePipeline", this.publishEvent);
    }

    async regenerateScene(projectId: string, sceneId: number, forceRegenerate: boolean, promptModification?: string) {
        const config = this.getRunnableConfig(projectId);
        const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);

        if (!existingCheckpoint) {
            console.warn(`[WorkflowService] No checkpoint found to regenerate scene for ${projectId}`);
            return;
        }

        const currentState = existingCheckpoint.channel_values as GraphState;
        const sceneIndex = currentState.storyboardState?.scenes.findIndex(s => s.id === sceneId);

        if (sceneIndex === undefined || sceneIndex === -1) {
            console.warn(`[WorkflowService] Scene ${sceneId} not found`);
            return;
        }

        const promptOverrides = currentState.scenePromptOverrides || {};
        if (promptModification) {
            promptOverrides[ sceneId ] = promptModification;
        }

        const updatedState: Partial<GraphState> = {
            currentSceneIndex: sceneIndex,
            forceRegenerateSceneId: forceRegenerate ? sceneId : undefined,
            scenePromptOverrides: promptOverrides,
        };

        const compiledGraph = await this.getCompiledGraph(projectId);
        const command = new Command({
            goto: "process_scene" as any,
            update: updatedState
        });

        await streamWithInterruptHandling(projectId, compiledGraph, command, config, "regenerateScene", this.publishEvent);
    }

    async resolveIntervention(projectId: string, action: 'retry' | 'skip' | 'abort', revisedParams?: any) {
        const config = this.getRunnableConfig(projectId);
        const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);

        if (!existingCheckpoint) {
            throw new Error(`No checkpoint found for ${projectId}`);
        }

        const currentState = existingCheckpoint.channel_values as GraphState;
        const interrupt = currentState.__interrupt__?.[ 0 ]?.value;

        if (!interrupt) {
            console.warn(`[WorkflowService] No interrupt to resolve`);
            return;
        }

        const compiledGraph = await this.getCompiledGraph(projectId);
        let command: Command;

        if (action === 'abort') {
            const updatedState = { __interrupt__: undefined, __interrupt_resolved__: true };
            const checkpointer = await this.checkpointerManager.getCheckpointer();
            // Manually update state to clear interrupt but don't resume execution
            await checkpointer!.put(config, {
                ...existingCheckpoint,
                channel_values: { ...currentState, ...updatedState }
            }, {} as any, {});

            await this.publishEvent({
                type: "WORKFLOW_FAILED",
                projectId: projectId,
                payload: { error: "Workflow canceled", nodeName: interrupt.nodeName },
                timestamp: new Date().toISOString()
            });
            return;
        } else if (action === 'skip') {
            const updatedState = {
                __interrupt__: undefined,
                __interrupt_resolved__: true,
                errors: [ ...(currentState.errors || []), {
                    node: interrupt.nodeName,
                    error: interrupt.error,
                    skipped: true,
                    timestamp: new Date().toISOString()
                } ]
            };
            command = new Command({ resume: updatedState });
        } else {
            // retry
            const paramsToUse = revisedParams
                ? { ...(interrupt.params || {}), ...revisedParams }
                : (interrupt.params || {});

            const updatedState = {
                __interrupt__: undefined,
                __interrupt_resolved__: true,
                ...mergeParamsIntoState(currentState, paramsToUse)
            };
            command = new Command({ resume: updatedState });
        }

        await streamWithInterruptHandling(projectId, compiledGraph, command, config, "resolveIntervention", this.publishEvent);
    }

    async regenerateFrame(projectId: string, sceneId: number, frameType: 'start' | 'end', promptModification?: string) {
        console.log(`[WorkflowService] Regenerating ${frameType} frame for scene ${sceneId}`);
        const config = this.getRunnableConfig(projectId);
        const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);

        if (!existingCheckpoint) {
            console.warn(`[WorkflowService] No checkpoint found to regenerate frame for ${projectId}`);
            return;
        }

        const currentState = existingCheckpoint.channel_values as GraphState;
        const scene = currentState.storyboardState?.scenes.find(s => s.id === sceneId);

        if (!scene) {
            console.error(`[WorkflowService] Scene ${sceneId} not found`);
            return;
        }

        const storageManager = new GCPStorageManager(this.gcpProjectId, projectId, this.bucketName);
        const textLlm = new LlmController();
        const imageLlm = new LlmController();
        const qualityAgent = new QualityCheckAgent(textLlm, storageManager);
        const frameComposer = new FrameCompositionAgent(imageLlm, qualityAgent, storageManager);

        const sceneCharacters = currentState.storyboardState!.characters.filter(char => scene.characters.includes(char.id));
        const sceneLocation = currentState.storyboardState!.locations.find(loc => scene.locationId.includes(loc.id));

        if (!sceneLocation) {
            console.error(`[WorkflowService] Location ${scene.locationId} not found`);
            return;
        }

        const previousSceneIndex = currentState.storyboardState!.scenes.findIndex(s => s.id === scene.id) - 1;
        const previousScene = previousSceneIndex >= 0 ? currentState.storyboardState!.scenes[ previousSceneIndex ] : undefined;

        const newFrame = await frameComposer.generateImage(
            scene,
            promptModification || "",
            frameType,
            sceneCharacters,
            [ sceneLocation ],
            frameType === 'start' ? previousScene?.endFrame : scene.startFrame,
            [
                ...sceneCharacters.flatMap(c => c.referenceImages || []),
                ...(sceneLocation.referenceImages || []),
            ]
        );

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

        const checkpointer = await this.checkpointerManager.getCheckpointer();
        await checkpointer!.put(config, {
            ...existingCheckpoint,
            channel_values: newState
        }, {} as any, {});

        await this.publishEvent({
            type: "FULL_STATE",
            projectId,
            payload: { state: newState },
            timestamp: new Date().toISOString(),
        });

        console.log(`[WorkflowService] Successfully regenerated ${frameType} frame for scene ${sceneId}`);
    }

    async getFullState(projectId: string) {
        const config = this.getRunnableConfig(projectId);
        const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);

        if (existingCheckpoint && existingCheckpoint.channel_values) {
            await this.publishEvent({
                type: "FULL_STATE",
                projectId,
                payload: { state: existingCheckpoint.channel_values as GraphState },
                timestamp: new Date().toISOString(),
            });

            const compiledGraph = await this.getCompiledGraph(projectId);
            await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, config, this.publishEvent);
        } else {
            console.warn(`[WorkflowService] No checkpoint found for projectId: ${projectId}. Checking storage.`);

            const sm = new GCPStorageManager(this.gcpProjectId, projectId, this.bucketName);
            try {
                const storyboardPath = `${projectId}/scenes/storyboard.json`;
                const storyboard = await sm.downloadJSON<any>(storyboardPath);

                console.log("   Found existing storyboard in storage.");
                const state = {
                    localAudioPath: "",
                    creativePrompt: storyboard.metadata?.creativePrompt || "",
                    hasAudio: false,
                    storyboard,
                    storyboardState: storyboard,
                    currentSceneIndex: 0,
                    audioGcsUri: "",
                    errors: [],
                    generationRules: [],
                    refinedRules: [],
                    attempts: {},
                } as GraphState;

                await this.publishEvent({
                    type: "FULL_STATE",
                    projectId,
                    payload: { state },
                    timestamp: new Date().toISOString(),
                });
            } catch (error) {
                console.warn(`[WorkflowService] No state found in storage for ${projectId}`);
            }
        }
    }

    private async buildInitialState(projectId: string, payload: any): Promise<InitialGraphState> {
        const sm = new GCPStorageManager(this.gcpProjectId, projectId, this.bucketName);
        let audioPublicUri;

        if (payload.audioGcsUri) {
            audioPublicUri = sm.getPublicUrl(payload.audioGcsUri);
        }

        try {
            console.log("   Checking for existing storyboard...");
            const storyboardPath = `${projectId}/scenes/storyboard.json`;
            // Note: GCPStorageManager methods might need adjustment if they don't support arbitrary paths easily
            // But assuming standard usage:
            const storyboard = await sm.downloadJSON<any>(storyboardPath); // cast to any to avoid type issues for now

            console.log("   Found existing storyboard.");
            return {
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
            console.log("   No existing storyboard found or error loading it. Starting fresh workflow.");
            return {
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
    }
}
