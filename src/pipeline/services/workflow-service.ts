import { PipelineCommand, PipelineEvent } from "../../shared/types/pipeline.types";
import { Project, ProjectMetadata, Storyboard, WorkflowState } from "../../shared/types/workflow.types";
import { CinematicVideoWorkflow } from "../../workflow/graph";
import { CheckpointerManager } from "../../workflow/checkpointer-manager";
import { RunnableConfig } from "@langchain/core/runnables";
import { Command, CompiledStateGraph } from "@langchain/langgraph";
import { streamWithInterruptHandling } from "../helpers/stream-helper";
import { GCPStorageManager } from "../../workflow/storage-manager";
import { JobControlPlane } from "./job-control-plane";
import { v7 as uuidv7 } from 'uuid';
import { ProjectRepository } from "../project-repository";
import { mergeParamsIntoState, getAllBestFromAssets } from "../../shared/utils/utils";
import { imageModelName, qualityCheckModelName, textModelName, videoModelName } from "../../workflow/llm/google/models";
import { AssetVersionManager } from "../../workflow/asset-version-manager";
import { DistributedLockManager } from "./lock-manager";
import { JobRecordFrameRender } from "@shared/types/job.types";



export class WorkflowOperator {
    private checkpointerManager: CheckpointerManager;
    private controlPlane: JobControlPlane;
    private publishEvent: (event: PipelineEvent) => Promise<void>;
    private projectRepository: ProjectRepository;
    private lockManager: DistributedLockManager;
    private activeControllers: Map<string, AbortController> = new Map();
    private gcpProjectId: string;
    private bucketName: string;

    constructor(
        checkpointerManager: CheckpointerManager,
        controlPlane: JobControlPlane,
        publishEvent: (event: PipelineEvent) => Promise<void>,
        projectRepository: ProjectRepository,
        lockManager: DistributedLockManager,
        gcpProjectId: string,
        bucketName: string
    ) {
        this.checkpointerManager = checkpointerManager;
        this.controlPlane = controlPlane;
        this.publishEvent = publishEvent;
        this.projectRepository = projectRepository;
        this.lockManager = lockManager;

        this.gcpProjectId = gcpProjectId;
        this.bucketName = bucketName;
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
            lockManager: this.lockManager,
            controller
        });
        workflow.publishEvent = this.publishEvent;
        return workflow;
    }

    private async withProjectLock<T>(projectId: string, action: () => Promise<T>): Promise<T> {
        const lockAcquired = await this.lockManager.acquireLock(projectId, {
            lockTTL: 60000,
            heartbeatInterval: 20000,
        });

        if (!lockAcquired) {
            console.error(`[WorkflowOperator] ❌ Failed to acquire lock for project ${projectId}. Another operation is likely in progress.`);
            throw new Error(`Project ${projectId} is currently locked by another process.`);
        }

        try {
            return await action();
        } finally {
            await this.lockManager.releaseLock(projectId);
        }
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
        return this.withProjectLock(projectId, async () => {
            const initialProject = await this.buildInitialProject(projectId, payload);

            const inserted = await this.projectRepository.createProject(initialProject);
            await this.publishEvent({
                type: "WORKFLOW_STARTED",
                projectId: inserted.id,
                payload: { project: inserted },
                timestamp: new Date().toISOString()
            });
            const config = this.getRunnableConfig(projectId);
            const state = WorkflowState.parse({
                id: inserted.id,
                projectId: inserted.id,
                project: null,
                hasAudio: inserted.metadata.hasAudio,
                currentSceneIndex: inserted.currentSceneIndex,
            });
            const compiled = await this.getCompiledGraph(projectId, this.getAbortController(projectId));
            await streamWithInterruptHandling(projectId, compiled, state, config, "startPipeline", this.publishEvent);
        });
    }


    async resumePipeline(projectId: string) {
        return this.withProjectLock(projectId, async () => {
            const config = this.getRunnableConfig(projectId);
            const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);
            if (!existingCheckpoint) {
                console.warn(`[WorkflowOperator] No checkpoint found to resume for ${projectId}`);
            }

            const compiledGraph = await this.getCompiledGraph(projectId, this.getAbortController(projectId));
            await streamWithInterruptHandling(projectId, compiledGraph, null, config, "resumePipeline", this.publishEvent);
        });
    }


    async regenerateScene(projectId: string, { sceneId, promptModification, forceRegenerate }: Extract<PipelineCommand, { type: "REGENERATE_SCENE"; }>[ 'payload' ]) {
        return this.withProjectLock(projectId, async () => {
            const config = this.getRunnableConfig(projectId);
            const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);
            if (!existingCheckpoint) {
                console.warn(`[WorkflowOperator.regenerateScene] No checkpoint found to regenerate scene ${sceneId}`);
            }

            const project = await this.projectRepository.getProject(projectId);
            project.forceRegenerateSceneIds.push(sceneId);

            const updated = await this.projectRepository.updateProject(projectId, project);
            const compiled = await this.getCompiledGraph(projectId, this.getAbortController(projectId));
            const command = new Command({
                goto: "process_scene",
                update: { project: updated }
            });
            await streamWithInterruptHandling(projectId, compiled, command, config, "regenerateScene", this.publishEvent);
        });
    }


    // TODO: FIX REVISEDPARAMS DESTINATION
    async resolveIntervention(projectId: string, { action, revisedParams }: Extract<PipelineCommand, { type: "RESOLVE_INTERVENTION"; }>[ 'payload' ]) {
        return this.withProjectLock(projectId, async () => {
            const config = this.getRunnableConfig(projectId);
            const existingCheckpoint = await this.checkpointerManager.loadCheckpoint(config);
            if (!existingCheckpoint) {
                throw new Error(`No checkpoint found for ${projectId}`);
            }

            const state = WorkflowState.parse(existingCheckpoint.channel_values as WorkflowState);
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
                    commandId: uuidv7(),
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
                    errors: [ {
                        projectId, 
                        node: interrupt.nodeName,
                        error: interrupt.error,
                        shouldRetry: false,
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
        });
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

        const assetKey = frameType === 'start' ? "scene_start_frame" : "scene_end_frame";
        const jobPayload: JobRecordFrameRender['payload'] = {
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
        };


        await this.controlPlane.createJob({
            type: "FRAME_RENDER",
            assetKey: assetKey,
            projectId: projectId,
            payload: jobPayload,
            maxRetries: 3
        });
    }

    async getProjectState(projectId: string) {

        const project = await this.projectRepository.getProjectFullState(projectId);
        await this.publishEvent({
            type: "FULL_STATE",
            commandId: uuidv7(),
            projectId,
            payload: {
                project
            },
            timestamp: new Date().toISOString(),
        });
        return;
    }

    private async buildInitialProject(projectId: string, payload: Extract<PipelineCommand, { type: "START_PIPELINE"; }>[ 'payload' ]): Promise<Project> {

        try {
            console.log(`[WorkflowOperator] Building initial state from DB for ${projectId}`);
            const project = await this.projectRepository.getProject(projectId);

            if (project) {
                return Project.parse(project);
            }
        } catch (error) {
            console.warn("No existing project found in DB. Starting fresh workflow.");
        }

        const sm = new GCPStorageManager(this.gcpProjectId, projectId, this.bucketName);
        let audioPublicUri;
        if (payload.audioGcsUri) {
            audioPublicUri = sm.getPublicUrl(payload.audioGcsUri);
        }

        const metadata = ProjectMetadata.parse({
            projectId: projectId,
            title: payload.title,
            initialPrompt: payload.initialPrompt,
            audioGcsUri: payload.audioGcsUri,
            audioPublicUri: audioPublicUri,
            hasAudio: !!payload.audioGcsUri,
        });

        const storyboard = Storyboard.parse({ metadata });

        return Project.parse({
            id: projectId,
            metadata,
            storyboard,
        });
    }

}
