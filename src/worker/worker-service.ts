import { JobControlPlane } from "../pipeline/services/job-control-plane";
import { JobEvent } from "../shared/types/job.types";
import { GCPStorageManager } from "../workflow/storage-manager";
import { TextModelController } from "../workflow/llm/text-model-controller";
import { VideoModelController } from "../workflow/llm/video-model-controller";
import { AudioProcessingAgent } from "../workflow/agents/audio-processing-agent";
import { CompositionalAgent } from "../workflow/agents/compositional-agent";
import { QualityCheckAgent } from "../workflow/agents/quality-check-agent";
import { SemanticExpertAgent } from "../workflow/agents/semantic-expert-agent";
import { FrameCompositionAgent } from "../workflow/agents/frame-composition-agent";
import { SceneGeneratorAgent } from "../workflow/agents/scene-generator";
import { ContinuityManagerAgent } from "../workflow/agents/continuity-manager";
import { AttemptMetric, Project, Scene } from "../shared/types/workflow.types";
import { deleteBogusUrlsStoryboard } from "../shared/utils/utils";
import { PipelineEvent } from "../shared/types/pipeline.types";
import { ProjectRepository } from "../pipeline/project-repository";
import { MediaController } from "../workflow/media-controller";
import { AssetVersionManager } from "../workflow/asset-version-manager";
import { logContextStore } from "../shared/format-loggers";
import { DistributedLockManager } from "../pipeline/services/lock-manager";
import { v7 as uuidv7 } from 'uuid';



/**
 * Orchestrates job execution for AI agents.
 * Ensures execution happens within a safe asynchronous context.
 */
export class WorkerService {

    private textModel = new TextModelController('google');
    private videoModel = new VideoModelController('google');
    private projectRepository = new ProjectRepository();

    constructor(
        private gcpProjectId: string,
        private workerId: string,
        private bucketName: string,
        private jobControlPlane: JobControlPlane,
        private lockManager: DistributedLockManager,
        private publishJobEvent: (event: JobEvent) => Promise<void>,
        private publishPipelineEvent: (event: PipelineEvent) => Promise<void>,
    ) { }

    /**
     * Retrieve agents with tenant-hydrated functionality
     * @param projectId 
     * @param signal 
     * @returns 
     */
    private getAgents(projectId: string, signal?: AbortSignal) {

        const assetVersionManager = new AssetVersionManager(this.projectRepository);
        const storageManager = new GCPStorageManager(this.gcpProjectId, projectId, this.bucketName);
        const mediaController = new MediaController(storageManager);
        const agentOptions = { signal };

        const qualityAgent = new QualityCheckAgent(this.textModel, storageManager, agentOptions);

        const frameCompositionAgent = new FrameCompositionAgent(
            this.textModel,
            this.textModel,
            qualityAgent,
            storageManager,
            assetVersionManager,
            agentOptions
        );

        return {
            storageManager,
            audioProcessingAgent: new AudioProcessingAgent(this.textModel, storageManager, mediaController, agentOptions),
            compositionalAgent: new CompositionalAgent(this.textModel, storageManager, assetVersionManager, agentOptions),
            semanticExpert: new SemanticExpertAgent(this.textModel),
            frameCompositionAgent,
            sceneAgent: new SceneGeneratorAgent(this.videoModel, qualityAgent, storageManager, assetVersionManager, agentOptions),
            continuityAgent: new ContinuityManagerAgent(
                this.textModel,
                this.textModel,
                frameCompositionAgent,
                qualityAgent,
                storageManager,
                assetVersionManager,
                agentOptions
            )
        };
    }

    /**
     * Processes a specific job by claiming it and executing the relevant agent logic.
     * Uses AsyncLocalStorage to ensure all logs and agent sub-tasks are traceable.
     * * @param jobId - The ID of the job dispatched by the system.
     * @param projectId - The project the job belongs to.
     */
    async processJob(jobId: string) {

        const job = await this.jobControlPlane.claimJob(jobId);
        if (!job) {
            console.warn(`[Worker] Job ${jobId} unavailable or concurrency limit reached.`);
            return;
        }

        const onProgress = async (scene: Scene, progress?: number) => {
            console.log(`[Job ${jobId}] Progress: ${scene.progressMessage}`);
            await this.publishPipelineEvent({
                type: "SCENE_PROGRESS",
                projectId: job.projectId,
                payload: { scene, progress },
                timestamp: new Date().toISOString(),
            });
        };

        await logContextStore.run({
            jobId: job.id,
            projectId: job.projectId,
            workerId: this.workerId,
            correlationId: uuidv7(),
            shouldPublishLog: true
        }, async () => {
            try {

                await this.publishJobEvent({ type: "JOB_STARTED", jobId });
                console.log(`[Worker ${this.workerId}] Executing work for job ${jobId} (${job.type})`);

                const controller = new AbortController();
                const agents = this.getAgents(job.projectId, controller.signal);

                let result = {} as typeof job.result;
                let payload;
                switch (job.type) {
                    case "EXPAND_CREATIVE_PROMPT": {
                        payload = job.payload;
                        const expanded = await agents.compositionalAgent.expandCreativePrompt(
                            payload.title,
                            payload.initialPrompt,
                            { maxRetries: 3, attempt: 1, initialDelay: 1000, projectId: job.projectId }
                        );
                        result = { expandedPrompt: expanded };
                        break;
                    }
                    case "GENERATE_STORYBOARD": {
                        payload = job.payload;
                        let storyboard = await agents.compositionalAgent.generateStoryboardFromPrompt(
                            payload.title,
                            payload.enhancedPrompt,
                            { attempt: job.attempt, maxRetries: job.maxRetries, projectId: job.projectId }
                        );
                        result = { storyboard: deleteBogusUrlsStoryboard(storyboard) };
                        break;
                    }
                    case "PROCESS_AUDIO_TO_SCENES": {
                        payload = job.payload;
                        const { segments, totalDuration } = await agents.audioProcessingAgent.processAudioToScenes(
                            job.payload.audioPublicUri,
                            payload.enhancedPrompt,
                        );
                        result = { segments, totalDuration };
                        break;
                    }
                    case "ENHANCE_STORYBOARD": {
                        payload = job.payload;
                        const storyboard = await agents.compositionalAgent.generateFullStoryboard(
                            payload.storyboard,
                            payload.enhancedPrompt,
                            { initialDelay: 30000, attempt: job.attempt, maxRetries: job.maxRetries, projectId: job.projectId }
                        );
                        result = { storyboard };
                        break;
                    }
                    case "SEMANTIC_ANALYSIS": {
                        const project = await this.projectRepository.getProjectFullState(job.projectId);
                        const dynamicRules = await agents.semanticExpert.generateRules(project.storyboard);
                        result = { dynamicRules };
                        break;
                    }
                    case "GENERATE_CHARACTER_ASSETS": {
                        payload = job.payload;
                        const characters = await agents.continuityAgent.generateCharacterAssets(
                            payload.characters,
                            payload.generationRules,
                        );
                        result = { characters };
                        break;
                    }
                    case "GENERATE_LOCATION_ASSETS": {
                        const locations = await this.projectRepository.getProjectLocations(job.projectId);
                        const project = await this.projectRepository.getProject(job.projectId);

                        const updatedLocations = await agents.continuityAgent.generateLocationAssets(
                            locations,
                            project.generationRules || []
                        );
                        result = { locations: updatedLocations };
                        break;
                    }
                    case "GENERATE_SCENE_FRAMES": {
                        payload = job.payload;
                        const project = await this.projectRepository.getProjectFullState(job.projectId);

                        // TODO Check job end for write op, possibly impl a callback for writes
                        const updatedScenes = await agents.continuityAgent.generateSceneFramesBatch(
                            project,
                            onProgress
                        );
                        result = { updatedScenes };
                        break;
                    }

                    // TODO Clear promptoverride after successful job
                    case "GENERATE_SCENE_VIDEO": {
                        payload = job.payload;
                        const project = await this.projectRepository.getProjectFullState(job.projectId);
                        const scene = project.scenes[ payload.sceneIndex ];
                        const generateAudio = project.metadata.hasAudio;

                        const {
                            enhancedPrompt,
                            characterReferenceImages,
                            locationReferenceImages,
                            sceneCharacters,
                            location,
                            previousScene,
                            generationRules,
                        } = await agents.continuityAgent.prepareAndRefineSceneInputs(scene, project, false);

                        const onComplete = (_scene: Scene, _attemptMetric: Omit<AttemptMetric, 'sceneId'>) => {
                            const attemptMetric: AttemptMetric = {
                                ..._attemptMetric,
                                sceneId: _scene.id,
                            };
                            console.log(`[Job ${jobId}] complete:`, attemptMetric);
                            this.projectRepository.updateScenes([ _scene ]);
                        };

                        const assets = scene.assets;
                        const startFrame = assets[ 'scene_start_frame' ]!.versions[ assets[ 'scene_start_frame' ]!.best ].data;
                        const endFrame = assets[ 'scene_end_frame' ]!.versions[ assets[ 'scene_end_frame' ]!.best ].data;
                        result = await agents.sceneAgent.generateSceneWithQualityCheck({
                            scene,
                            enhancedPrompt,
                            sceneCharacters,
                            sceneLocation: location,
                            previousScene,
                            version: payload.version,
                            startFrame: startFrame,
                            endFrame: endFrame,
                            characterReferenceImages,
                            locationReferenceImages,
                            generateAudio,
                            onComplete,
                            onProgress,
                            generationRules
                        });
                        break;
                    }
                    case "RENDER_VIDEO": {
                        payload = job.payload;

                        let renderedVideo;
                        if (payload.audioGcsUri) {
                            renderedVideo = await agents.audioProcessingAgent.mediaController.stitchScenes(payload.videoPaths, job.projectId, job.attempt, payload.audioGcsUri);
                        } else {
                            renderedVideo = await agents.audioProcessingAgent.mediaController.stitchScenes(payload.videoPaths, job.projectId, job.attempt,);
                        }
                        result = { renderedVideo };
                        break;
                    }
                    case "FRAME_RENDER": {
                        payload = job.payload;

                        const frame = await agents.frameCompositionAgent.generateImage(
                            payload.scene,
                            payload.prompt,
                            payload.framePosition,
                            payload.sceneCharacters,
                            payload.sceneLocations,
                            payload.previousFrame,
                            payload.referenceImages,
                            onProgress
                        );
                        result = { frame };
                        break;
                    }
                    default:
                        throw new Error(`Unknown job type: ${JSON.stringify(job)}`);
                }

                await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED", result });
                await this.publishJobEvent({ type: "JOB_COMPLETED", jobId });
                console.log(`[Worker ${this.workerId}] Job ${jobId} completed`);

            } catch (error: any) {
                console.error(`[Job ${jobId}] Execution failed:`, error);

                await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "FAILED", error: error.message, attempt: job.attempt + 1 });

                await this.publishJobEvent({ type: "JOB_FAILED", jobId, error: error.message });
            }
        });
    }
}
