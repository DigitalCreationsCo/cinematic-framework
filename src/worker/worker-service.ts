import { JobControlPlane } from "../pipeline/services/job-control-plane";
import { JobEvent } from "../shared/types/job-types";
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
import { AttemptMetric, Project, Scene } from "../shared/types/pipeline.types";
import { deleteBogusUrlsStoryboard } from "../shared/utils/utils";
import { PipelineEvent } from "../shared/types/pubsub.types";
import { ProjectRepository } from "../pipeline/project-repository";
import { MediaController } from "../workflow/media-controller";
import { AssetVersionManager } from "../workflow/asset-version-manager";



export class WorkerService {
    private workerId: string;
    private bucketName: string;

    private jobControlPlane: JobControlPlane;
    private publishJobEvent: (event: JobEvent) => Promise<void>;
    private publishPipelineEvent: (event: PipelineEvent) => Promise<void>;
    private projectRepository: ProjectRepository;

    private textModel: TextModelController;
    private videoModel: VideoModelController;

    constructor(
        workerId: string,
        bucketName: string,
        jobControlPlane: JobControlPlane,
        publishJobEvent: (event: JobEvent) => Promise<void>,
        publishPipelineEvent: (event: PipelineEvent) => Promise<void>,
    ) {
        this.workerId = workerId;
        this.bucketName = bucketName;
        this.jobControlPlane = jobControlPlane;
        this.publishJobEvent = publishJobEvent;
        this.publishPipelineEvent = publishPipelineEvent;
        this.textModel = new TextModelController('google');
        this.videoModel = new VideoModelController('google');
        this.projectRepository = new ProjectRepository();
    }

    /**
     * Retrieve agents with tenant-hydrated functionality
     * @param projectId 
     * @param signal 
     * @returns 
     */
    private getAgents(projectId: string, signal?: AbortSignal) {

        const assetVersionManager = new AssetVersionManager(this.projectRepository);
        const storageManager = new GCPStorageManager(projectId, projectId, this.bucketName);
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

    async processJob(jobId: string) {
        console.log(`[Worker ${this.workerId}] Attempting to claim job ${jobId}`);

        // Phase 1: Claim Job
        // If this throws, it bubbles up to be Nacked (transient DB error)
        // If it returns false, we return immediately (duplicate message, Ack)
        const claimed = await this.jobControlPlane.claimJob(jobId, this.workerId);
        if (!claimed) {
            console.log(`[Worker ${this.workerId}] Failed to claim job ${jobId} (already taken or not in CREATED state).`);
            return;
        }

        // Phase 2: Processing
        // Errors here are "Job Failed", catch them, update DB state, and return (Ack)
        try {
            const job = await this.jobControlPlane.getJob(jobId);
            if (!job) {
                console.error(`[Worker ${this.workerId}] Job ${jobId} not found after claim`);
                // This is weird state, but we claimed it. Treating as failed processing.
                return;
            }

            await this.publishJobEvent({ type: "JOB_STARTED", jobId });
            console.log(`[Worker ${this.workerId}] Executing work for job ${jobId} (${job.type})`);

            const controller = new AbortController();
            const agents = this.getAgents(job.projectId, controller.signal);

            const onProgress = async (scene: Scene, progress?: number) => {
                console.log(`[Job ${jobId}] Progress: ${scene.progressMessage}`);
                await this.publishPipelineEvent({
                    type: "SCENE_PROGRESS",
                    projectId: job.projectId,
                    payload: { scene, progress },
                    timestamp: new Date().toISOString(),
                });
            };

            let result = {} as typeof job.result;
            let payload;
            switch (job.type) {
                case "EXPAND_CREATIVE_PROMPT": {
                    payload = job.payload;
                    const expanded = await agents.compositionalAgent.expandCreativePrompt(
                        payload.title,
                        payload.initialPrompt
                    );
                    result = { expandedPrompt: expanded };
                    break;
                }
                case "GENERATE_STORYBOARD": {
                    payload = job.payload;
                    let storyboard = await agents.compositionalAgent.generateStoryboardFromPrompt(
                        payload.title,
                        payload.enhancedPrompt,
                        { attempt: job.retryCount, maxRetries: job.maxRetries }
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
                        { initialDelay: 30000, attempt: job.retryCount, maxRetries: job.maxRetries }
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

                    const onAttemptComplete = (_scene: Scene, attemptMetric: AttemptMetric) => {
                        console.log(`[Job ${jobId}] Attempt complete:`, attemptMetric);
                        this.projectRepository.updateScenes([_scene]);
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
                        attempt: payload.attempt,
                        startFrame: startFrame,
                        endFrame: endFrame,
                        characterReferenceImages,
                        locationReferenceImages,
                        generateAudio,
                        onAttemptComplete,
                        onProgress,
                        generationRules
                    });
                    break;
                }
                case "RENDER_VIDEO": {
                    payload = job.payload;

                    let renderedVideo;
                    if (payload.audioGcsUri) {
                        renderedVideo = await agents.audioProcessingAgent.mediaController.stitchScenes(payload.videoPaths, job.projectId, job.retryCount, payload.audioGcsUri);
                    } else {
                        renderedVideo = await agents.audioProcessingAgent.mediaController.stitchScenes(payload.videoPaths, job.projectId, job.retryCount,);
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

            await this.jobControlPlane.updateJobState(jobId, "COMPLETED", result);
            await this.publishJobEvent({ type: "JOB_COMPLETED", jobId });
            console.log(`[Worker ${this.workerId}] Job ${jobId} completed`);

        } catch (error: any) {
            console.error(`[Worker ${this.workerId}] Error processing job ${jobId}:`, error);
            await this.jobControlPlane.updateJobState(jobId, "FAILED", undefined, error.message);
            await this.publishJobEvent({ type: "JOB_FAILED", jobId, error: error.message });
        }
    }
}
