import { PipelineCommand, PipelineEvent } from "../../shared/types/pubsub.types";
import { InitialProject, Project, WorkflowState } from "../../shared/types/pipeline.types";
import { CinematicVideoWorkflow } from "../../workflow/graph";
import { CheckpointerManager } from "../../workflow/checkpointer-manager";
import { RunnableConfig } from "@langchain/core/runnables";
import { Command, CompiledStateGraph } from "@langchain/langgraph";
import { streamWithInterruptHandling } from "../helpers/stream-helper";
import { GCPStorageManager } from "../../workflow/storage-manager";
import { JobControlPlane } from "./job-control-plane";
import { v4 as uuidv4 } from 'uuid';
import { ProjectRepository } from "../project-repository";
import { mergeParamsIntoState, getAllBestFromAssets } from "../../shared/utils/utils";
import { imageModelName, qualityCheckModelName, textModelName, videoModelName } from "../../workflow/llm/google/models";
import { AssetVersionManager } from "../../workflow/asset-version-manager";
import { StatusError } from "@google-cloud/pubsub";



export class WorkflowOperator {
    private checkpointerManager: CheckpointerManager;
    private controlPlane: JobControlPlane;
    private publishEvent: (event: PipelineEvent) => Promise<void>;
    private projectRepository: ProjectRepository;
    private activeControllers: Map<string, AbortController> = new Map();
    private gcpProjectId: string;
    private bucketName: string;

    constructor(
        checkpointerManager: CheckpointerManager,
        controlPlane: JobControlPlane,
        publishEvent: (event: PipelineEvent) => Promise<void>,
        projectRepository: ProjectRepository,
        gcpProjectId?: string,
        bucketName?: string
    ) {
        this.checkpointerManager = checkpointerManager;
        this.controlPlane = controlPlane;
        this.publishEvent = publishEvent;
        this.projectRepository = projectRepository;

        this.gcpProjectId = gcpProjectId || process.env.GCP_PROJECT_ID!;
        this.bucketName = bucketName || process.env.GCP_BUCKET_NAME!;
        if (!this.bucketName) {
            throw new Error("GCP_BUCKET_NAME environment variable not set.");
        }
    }

    public getAbortController(projectId: string): AbortController {
        let controller = this.activeControllers.get(projectId);
        if (!controller || controller.signal.aborted) {
            controller = new AbortController();
            this.activeControllers.set(projectId, controller);
        }
        return controller;
    }

    private getWorkflowInstance(projectId: string, controller?: AbortController): CinematicVideoWorkflow {
        const workflow = new CinematicVideoWorkflow({
            gcpProjectId: this.gcpProjectId,
            projectId,
            bucketName: this.bucketName,
            jobControlPlane: this.controlPlane,
            controller
        });
        workflow.publishEvent = this.publishEvent;
        return workflow;
    }

    private async getCompiledGraph(projectId: string, controller?: AbortController): Promise<CompiledStateGraph<WorkflowState, Partial<WorkflowState>, string>> {
        const workflow = this.getWorkflowInstance(projectId, controller);
        const checkpointer = this.checkpointerManager.getCheckpointer();
        if (!checkpointer) {
            throw new Error("Checkpointer not initialized");
        }
        return workflow.graph.compile({ checkpointer });
    }

    private getRunnableConfig(projectId: string): RunnableConfig {
        const controller = this.getAbortController(projectId);
        return {
            configurable: { thread_id: projectId },
            signal: controller.signal
        };
    }

    public async stopPipeline(projectId: string) {
        console.log(`[WorkflowOperator.stopPipeline] Stopping pipeline ${projectId}`, { projectId });
        const controller = this.activeControllers.get(projectId);
        if (controller) {
            controller.abort();
            this.activeControllers.delete(projectId);
            console.log(`[WorkflowOperator] Aborted controller for ${projectId}`);
        } else {
            console.warn(`[WorkflowOperator] No active controller found for ${projectId} to stop.`, { projectId });
        }
    }

    async startPipeline(projectId: string, payload: Extract<PipelineCommand, { type: "START_PIPELINE"; }>[ 'payload' ]) {

        const initialProject = await this.buildInitialProject(projectId, payload);

        const inserted = await this.projectRepository.createProject(initialProject);
        await this.publishEvent({
            type: "WORKFLOW_STARTED",
            projectId: inserted.id,
            payload: { project: inserted },
            timestamp: new Date().toISOString()
        });
        const config = this.getRunnableConfig(projectId);
        const compiled = await this.getCompiledGraph(projectId, this.getAbortController(projectId));
        await streamWithInterruptHandling(projectId, compiled, initialProject, config, "startPipeline", this.publishEvent);
    }


    async resumePipeline(projectId: string) {

        const config = this.getRunnableConfig(projectId);
        const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);
        if (!existingCheckpoint) {
            console.warn(`[WorkflowOperator] No checkpoint found to resume for ${projectId}`);
            await this.publishEvent({
                type: "WORKFLOW_FAILED",
                projectId: projectId,
                payload: { error: "No existing pipeline found to resume." },
                timestamp: new Date().toISOString(),
            });
            return;
        }
        const compiledGraph = await this.getCompiledGraph(projectId, this.getAbortController(projectId));
        await streamWithInterruptHandling(projectId, compiledGraph, null, config, "resumePipeline", this.publishEvent);
    }


    async regenerateScene(projectId: string, { sceneId, promptModification, forceRegenerate }: Extract<PipelineCommand, { type: "REGENERATE_SCENE"; }>[ 'payload' ]) {

        const config = this.getRunnableConfig(projectId);
        const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);
        if (!existingCheckpoint) {
            console.warn(`[WorkflowOperator.regenerateScene] No checkpoint found to regenerate scene ${sceneId}`);
            return;
        }

        const assetManager = new AssetVersionManager(this.projectRepository);
        await assetManager.createVersionedAssets({ projectId, }, "scene_prompt", 'text', [ promptModification ], { model: textModelName });
        const project = await this.projectRepository.getProject(projectId);
        project.forceRegenerateSceneIds.push(sceneId);

        const updated = await this.projectRepository.updateProject(projectId, project);
        const compiled = await this.getCompiledGraph(projectId, this.getAbortController(projectId));
        const command = new Command({
            goto: "process_scene",
            update: updated
        });
        await streamWithInterruptHandling(projectId, compiled, command, config, "regenerateScene", this.publishEvent);
    }


    // TODO: FIX REVISEDPARAMS DESTINATION
    async resolveIntervention(projectId: string, { action, revisedParams }: Extract<PipelineCommand, { type: "RESOLVE_INTERVENTION"; }>[ 'payload' ]) {

        const config = this.getRunnableConfig(projectId);
        const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);
        if (!existingCheckpoint) {
            throw new Error(`No checkpoint found for ${projectId}`);
        }

        const state = existingCheckpoint.channel_values as WorkflowState;
        const interrupt = state.__interrupt__?.[ 0 ]?.value;
        if (!interrupt) {
            console.warn(`[WorkflowOperator] No interrupt to resolve`);
            return;
        }

        const compiled = await this.getCompiledGraph(projectId, this.getAbortController(projectId));
        let command: Command;
        if (action === 'abort') {
            const updatedState = { __interrupt__: undefined, __interrupt_resolved__: true };
            await this.checkpointerManager.saveCheckpoint(config, existingCheckpoint, updatedState);

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
                errors: [ ...(state.errors || []), {
                    node: interrupt.nodeName,
                    error: interrupt.error,
                    skipped: true,
                    timestamp: new Date().toISOString()
                } ]
            };
            command = new Command({ resume: updatedState });
        } else {
            const paramsToUse = revisedParams
                ? { ...(interrupt.params || {}), ...revisedParams }
                : (interrupt.params || {});

            const updatedState = {
                ...mergeParamsIntoState(state, paramsToUse),
                __interrupt__: undefined,
                __interrupt_resolved__: true,
            };
            command = new Command({ resume: updatedState });
        }
        await streamWithInterruptHandling(projectId, compiled, command, config, "resolveIntervention", this.publishEvent);
    }


    async updateSceneAsset(projectId: string, { scene, assetKey, version }: Extract<PipelineCommand, { type: "UPDATE_SCENE_ASSET"; }>[ 'payload' ]) {

        console.log(`[WorkflowOperator] Updating ${assetKey} for scene ${scene.id} to version ${version}`);
        const assetManager = new AssetVersionManager(this.projectRepository);

        // 1. Update Asset History in DB
        // If version is null, we treat it as "unsetting" the best version (set to 0)
        const targetVersion = version === null ? 0 : version;
        await assetManager.setBestVersion({ projectId, sceneId: scene.id }, assetKey, [ targetVersion ]);

        // 2. Refresh Scene State
        // We must fetch the latest scene from DB because assetManager has updated the 'assets' column
        // and potentially some flat fields. Our local 'scene' object is now stale.
        const updatedScene = await this.projectRepository.getScene(scene.id);

        // 3. Determine the data for the selected version
        // AssetManager 1-based indexing for versions matches the 'best' pointer.
        const bestVersionIndex = updatedScene.assets[ assetKey ]?.best || 0;
        const bestVersionData = bestVersionIndex > 0
            ? updatedScene.assets[ assetKey ]?.versions[ bestVersionIndex ]?.data || ""
            : "";

        // 4. Sync Flat Fields
        // AssetManager syncs 'generatedVideo' but NOT 'startFrame' or 'endFrame'.
        // We manually ensure these fields match the selected version.
        let needsUpdate = false;

        // 'scene_video' -> 'generatedVideo' is handled by AssetManager, but we check for status updates.
        if (assetKey === 'scene_video') {
            // If we have valid video data and status isn't complete, mark it complete.
            if (bestVersionData && updatedScene.status !== 'complete') {
                await this.projectRepository.updateSceneStatus(updatedScene.id, 'complete');
                // Status update saves to DB, so we might not need another save unless other fields changed.
                // However, to be safe if start/end frames also changed in this same logic (unlikely but possible in future), we keep needsUpdate logic separate.
            }
        }

        // 5. Persist Flat Field Updates if necessary
        if (needsUpdate) {
            await this.projectRepository.updateScenes([ updatedScene ]);
        }

        // 6. Broadcast new state
        await this.getProjectState(projectId);
    }

    async regenerateFrame(projectId: string, { sceneId, frameType, promptModification }: Extract<PipelineCommand, { type: "REGENERATE_FRAME"; }>[ 'payload' ]) {

        console.log(`[WorkflowOperator] Regenerating ${frameType} frame for scene ${sceneId}`);
        const projectCharacters = await this.projectRepository.getProjectCharacters(projectId);
        const projectLocations = await this.projectRepository.getProjectLocations(projectId);
        const projectScenes = await this.projectRepository.getProjectScenes(projectId);
        const scene = projectScenes.find(s => s.id === sceneId);
        if (!scene) {
            console.error(`[WorkflowOperator.regenerateFrame] Scene not found`);
            return;
        }

        const sceneCharacters = projectCharacters.filter(char => scene.characters.includes(char.id));
        const sceneLocation = projectLocations.find(loc => loc.id === scene.locationId);
        const previousScene = projectScenes.find(s => s.sceneIndex === scene.sceneIndex - 1);
        const previousSceneAssets = previousScene?.assets;
        if (!sceneLocation) {
            console.error(`[WorkflowOperator.regenerateFrame] Location ${scene.locationId} not found`);
            return;
        }

        const controller = this.getAbortController(projectId);
        const options = { signal: controller.signal };
        const sceneCharacterImages = sceneCharacters.flatMap(c => {
            const assets = getAllBestFromAssets(c.assets);
            return assets[ 'character_image' ]?.data ? [ assets[ 'character_image' ].data ] : [];
        });
        const sceneLocationImages = [ sceneLocation ].flatMap(l => {
            const assets = getAllBestFromAssets(l.assets);
            return assets[ 'location_image' ]?.data ? [ assets[ 'location_image' ].data ] : [];
        });
        
        const previousAssets = getAllBestFromAssets(previousSceneAssets);
        const previousFrame = frameType === 'start' ?
                previousAssets[ "scene_end_frame" ]?.data
                : previousAssets[ "scene_start_frame" ]?.data;

        const jobPayload = {
            scene,
            prompt: promptModification,
            framePosition: frameType,
            sceneCharacters,
            sceneLocations: [ sceneLocation ],
            previousFrame,
            referenceImages: [
                ...sceneCharacterImages,
                ...sceneLocationImages,
            ],
            sceneId,
            frameType,
            promptModification
        };
        const job = await this.controlPlane.createJob({
            id: uuidv4(),
            type: "FRAME_RENDER",
            projectId: projectId,
            payload: jobPayload,
            maxRetries: 3
        });
        console.log(`[WorkflowOperator] Dispatched job ${job.id} for frame regeneration. Worker will process asynchronously.`);
    }

    async getProjectState(projectId: string) {

        const scenes = await this.projectRepository.getProjectScenes(projectId);
        const characters = await this.projectRepository.getProjectCharacters(projectId);
        const locations = await this.projectRepository.getProjectLocations(projectId);
        const project = await this.projectRepository.getProject(projectId);

        await this.publishEvent({
            type: "FULL_STATE",
            projectId,
            payload: {
                project: {
                    ...project,
                    projectId,
                    characters,
                    locations,
                    scenes,
                }
            },
            timestamp: new Date().toISOString(),
        });
        return;

        //     const sm = new GCPStorageManager(this.gcpProjectId, projectId, this.bucketName);

        //     const statePath = await sm.getObjectPath({ type: "state" });
        //     const state = await sm.downloadJSON<Project>(statePath);
        //     console.log("   Found persistent state backup in storage.");

        //     await this.publishEvent({
        //         type: "FULL_STATE",
        //         projectId,
        //         payload: { state },
        //         timestamp: new Date().toISOString(),
        //     });
        // } catch(stateError) {
        //     try {
        //         const storyboardPath = `${projectId}/scenes/storyboard.json`;
        //         const storyboard = await sm.downloadJSON<any>(storyboardPath);

        //         console.log("   Found existing storyboard in storage.");
        //         const state = {
        //             localAudioPath: "",
        //             enhancedPrompt: storyboard.metadata?.enhancedPrompt || "",
        //             hasAudio: false,
        //             storyboard,
        //             storyboardState: storyboard,
        //             currentSceneIndex: 0,
        //             audioGcsUri: "",
        //             errors: [],
        //             generationRules: [],
        //             refinedRules: [],
        //             versions: {},
        //         } as Project;

        //         await this.publishEvent({
        //             type: "FULL_STATE",
        //             projectId,
        //             payload: { state },
        //             timestamp: new Date().toISOString(),
        //         });
        // }
    }

    private async buildInitialProject(projectId: string, payload: Extract<PipelineCommand, { type: "START_PIPELINE"; }>[ 'payload' ]): Promise<InitialProject> {

        try {
            console.log(`[WorkflowOperator] Building initial state from DB for ${projectId}`);
            const project = await this.projectRepository.getProject(projectId) as any;
            if (project.metadata) {
                return {
                    status: project.status,
                    currentSceneIndex: project.currentSceneIndex || 0,
                    storyboard: {
                        metadata: project.metadata,
                        characters: project.characters || [],
                        locations: project.locations || [],
                        scenes: project.scenes || [],
                    },
                    metadata: project.metadata,
                    characters: project.characters || [],
                    locations: project.locations || [],
                    scenes: project.scenes || [],
                    generationRules: [],
                } as unknown as InitialProject;
            };
        } catch (error) {
            console.warn("No existing project found. Starting fresh workflow.");
        }

        // 2. Fallback to GCS
        // try {
        //     const statePath = await sm.getObjectPath({ type: "state" });
        //     const savedState = await sm.downloadJSON<Project>(statePath);
        //     console.log("   Found persistent state backup in GCS. Using as initial state.");
        //     return {
        //         ...savedState,
        //         localAudioPath: payload.audioGcsUri || savedState.localAudioPath || "",
        //         initialPrompt: payload.initialPrompt || savedState.enhancedPrompt,
        //         audioGcsUri: payload.audioGcsUri || savedState.audioGcsUri,
        //         audioPublicUri: audioPublicUri || savedState.audioPublicUri,
        //         hasAudio: !!(payload.audioGcsUri || savedState.audioGcsUri),
        //     };
        // } catch (e) {
        //     try {
        //         console.log("   Checking for existing storyboard in GCS...");
        //         const storyboardPath = `${projectId}/scenes/storyboard.json`;
        //         const storyboard = await sm.downloadJSON<Storyboard>(storyboardPath);

        //         console.log("   Found existing storyboard in GCS.");
        //         return {
        //             enhancedPrompt: payload.enhancedPrompt,
        //             audioGcsUri: payload.audioGcsUri,
        //             audioPublicUri: audioPublicUri,
        //             hasAudio: !!payload.audioGcsUri,
        //             storyboard: storyboard,
        //             storyboardState: storyboard,
        //             currentSceneIndex: 0,
        //             errors: [],
        //             generationRules: [],
        //             refinedRules: [],
        //             versions: {},
        //         };
        //     } catch (error) {
        //         console.log("   No existing storyboard found or error loading it. Starting fresh workflow.");
        //     }
        // }

        const sm = new GCPStorageManager(this.gcpProjectId, projectId, this.bucketName);
        let audioPublicUri;
        if (payload.audioGcsUri) {
            audioPublicUri = sm.getPublicUrl(payload.audioGcsUri);
        }
        const newProjectMetadata = {
            title: payload.title || "",
            initialPrompt: payload.initialPrompt,
            audioGcsUri: payload.audioGcsUri,
            audioPublicUri: audioPublicUri,
            hasAudio: !!payload.audioGcsUri,

            models: {
                videoModel: videoModelName,
                imageModel: imageModelName,
                textModel: textModelName,
                qaModel: qualityCheckModelName,
            }
        } as InitialProject[ 'metadata' ];

        return {
            status: "pending",
            currentSceneIndex: 0,
            storyboard: Object.freeze({
                metadata: newProjectMetadata,
                characters: [],
                locations: [],
                scenes: []
            }),
            metadata: newProjectMetadata,
            characters: [],
            locations: [],
            scenes: [],
        } as unknown as InitialProject;
    }
}
