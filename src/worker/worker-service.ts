import { JobControlPlane } from "../shared/services/job-control-plane.js";
import { GenerativeResultEnhanceStoryboard, JobEvent } from "../shared/types/job.types.js";
import { GCPStorageManager } from "../shared/services/storage-manager.js";
import { TextModelController } from "../shared/llm/text-model-controller.js";
import { VideoModelController } from "../shared/llm/video-model-controller.js";
import { AudioProcessingAgent } from "../shared/agents/audio-processing-agent.js";
import { CompositionalAgent } from "../shared/agents/compositional-agent.js";
import { QualityCheckAgent } from "../shared/agents/quality-check-agent.js";
import { SemanticExpertAgent } from "../shared/agents/semantic-expert-agent.js";
import { FrameCompositionAgent } from "../shared/agents/frame-composition-agent.js";
import { SceneGeneratorAgent } from "../shared/agents/scene-generator.js";
import { ContinuityManagerAgent } from "../shared/agents/continuity-manager.js";
import { VersionMetric, AssetVersion, Project, Character, Location, Scene, Storyboard, ProjectMetadata, InsertProject, SceneEntity, SceneAttributes, InsertScene } from "../shared/types/index.js";
import { SaveAssetsCallback, PipelineEvent, UpdateSceneCallback, GetAttemptMetricCallback, OnAttemptCallback } from "../shared/types/pipeline.types.js";
import { ProjectRepository } from "../shared/services/project-repository.js";
import { MediaController } from "../shared/services/media-controller.js";
import { AssetVersionManager } from "../shared/services/asset-version-manager.js";
import { logContextStore } from "../shared/logger/index.js";
import { DistributedLockManager } from "../shared/services/lock-manager.js";
import { v7 as uuidv7 } from 'uuid';
import { videoModelName } from "../shared/llm/google/models.js";
import { extractGenerationRules } from "../shared/prompts/prompt-composer.js";
import { mapDbProjectToDomain } from "../shared/domain/project-mappers.js";
import { mapDomainSceneToInsertSceneDb } from "../shared/domain/scene-mappers.js";
import { mapDomainCharacterToInsertCharacterDb } from "../shared/domain/character-mappers.js";
import { mapDomainLocationToInsertLocationDb, mapReferenceIdsToIds } from "../shared/domain/location-mappers.js";

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

    private async publishStateUpdate(project: Project) {
        this.publishPipelineEvent({
            type: "FULL_STATE",
            projectId: project.id,
            payload: { project },
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Retrieve agents with tenant-hydrated functionality
     * @param projectId 
     * @param signal 
     * @returns 
     */
    private getAgents(projectId: string, signal?: AbortSignal) {

        const assetManager = new AssetVersionManager(this.projectRepository);
        const storageManager = new GCPStorageManager(this.gcpProjectId, projectId, this.bucketName);
        const mediaController = new MediaController(storageManager);
        const agentOptions = { signal };

        const qualityAgent = new QualityCheckAgent(this.textModel, storageManager, agentOptions);

        const frameCompositionAgent = new FrameCompositionAgent(
            this.textModel,
            this.textModel,
            qualityAgent,
            storageManager,
            assetManager,
            agentOptions
        );

        return {
            assetManager,
            storageManager,
            audioProcessingAgent: new AudioProcessingAgent(this.textModel, storageManager, mediaController, agentOptions),
            compositionalAgent: new CompositionalAgent(this.textModel, storageManager, assetManager, agentOptions),
            semanticExpert: new SemanticExpertAgent(this.textModel),
            frameCompositionAgent,
            sceneAgent: new SceneGeneratorAgent(this.videoModel, qualityAgent, storageManager, assetManager, agentOptions),
            continuityAgent: new ContinuityManagerAgent(
                this.textModel,
                this.textModel,
                frameCompositionAgent,
                qualityAgent,
                storageManager,
                assetManager,
                agentOptions
            )
        };
    }

    /**
     * Processes a dispatched job by claiming it and executing the relevant agent logic.
     * Uses AsyncLocalStorage to ensure all logs and agent sub-tasks are traceable.
     * @param jobId - The ID of the job dispatched by the system.
     */
    async processJob(jobId: string): Promise<void> {

        const claim = await this.jobControlPlane.claimJob(jobId);
        if (!claim) {
            console.warn({ jobId }, `Job unavailable or concurrency limit reached`);
            return;
        }

        const [ job, claimedAtISO ] = claim;
        const startTime = new Date(claimedAtISO).getTime();

        await logContextStore.run({
            jobId: job.id,
            jobUniqueKey: job.uniqueKey,
            projectId: job.projectId,
            w_id: this.workerId,
            correlationId: uuidv7(),
            shouldPublish: true
        }, async () => {
            try {

                await this.publishJobEvent({ type: "JOB_STARTED", jobId });
                console.log({ job, startTime }, `Executing job.`);

                const controller = new AbortController();
                const agents = this.getAgents(job.projectId, controller.signal);

                const updateScene: UpdateSceneCallback = async (scene, saveToDb = true) => {
                    console.log({ projectId: scene.projectId, sceneId: scene.id }, `Updating scene`);
                    if (saveToDb) this.projectRepository.updateScenes([ scene ]);

                    this.publishPipelineEvent({
                        type: "SCENE_UPDATE",
                        projectId: job.projectId,
                        payload: { scene },
                        timestamp: new Date().toISOString(),
                    });
                };

                const createIncrementer = (jobId: string): OnAttemptCallback => async (attempt: number) => {
                    this.jobControlPlane.updateJobSafeAndIncrementAttempt(jobId, attempt);
                };

                const getAttemptMetric = (): GetAttemptMetricCallback => (attemptMetric): VersionMetric => {
                    const endTime = Date.now();
                    const attemptDuration = endTime - startTime;
                    const versionMetric = {
                        ...attemptMetric,
                        endTime,
                        attemptDuration,
                        jobId,
                    };
                    return versionMetric;
                    // save the metric here or after calling
                };
                const saveMetric = getAttemptMetric();

                const saveAssets: SaveAssetsCallback = async (...[ scope, assetKey, type, assets, metadata, setBest ]) => {
                    await agents.assetManager.createVersionedAssets(
                        scope,
                        assetKey,
                        type,
                        assets,
                        { ...metadata, jobId } as AssetVersion[ 'metadata' ],
                        setBest
                    );
                };

                switch (job.type) {
                    case "EXPAND_CREATIVE_PROMPT": {
                        try {
                            let project = await this.projectRepository.getProject(job.projectId);
                            if (!project.metadata.initialPrompt) throw new Error("No user prompt provided");

                            try {
                                let { data, metadata } = await agents.compositionalAgent.expandCreativePrompt(
                                    project.metadata.title,
                                    project.metadata.initialPrompt,
                                    { maxRetries: 3, attempt: 1, initialDelay: 1000, projectId: job.projectId }
                                );

                                try {
                                    const updated = await this.projectRepository.updateProject(project.id, {
                                        ...project,
                                        metadata: {
                                            ...project.metadata, enhancedPrompt: data.expandedPrompt,
                                        },
                                        storyboard: undefined
                                    });

                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);

                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (generateError: any) {
                                console.error({ error: generateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to generate");
                                throw new Error(`Failed to generate: ${generateError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "GENERATE_STORYBOARD": {
                        try {
                            let project = await this.projectRepository.getProject(job.projectId);
                            if (!project.metadata.enhancedPrompt) throw new Error("No enhanced prompt available");

                            try {
                                let { data, metadata } = await agents.compositionalAgent.generateStoryboardExclusivelyFromPrompt(
                                    project.metadata.title,
                                    project.metadata.enhancedPrompt,
                                    { attempt: job.attempt, maxRetries: job.maxRetries, projectId: job.projectId },
                                );

                                try {
                                    const characters: Character[] = data.storyboardAttributes.characters.map((character) => mapDomainCharacterToInsertCharacterDb({
                                        ...character,
                                        projectId: project.id,
                                    }));
                                    const locations: Location[] = data.storyboardAttributes.locations.map((location) => mapDomainLocationToInsertLocationDb({
                                        ...location,
                                        projectId: project.id,
                                    }));
                                    const scenes: Scene[] = data.storyboardAttributes.scenes.map(({ characterReferenceIds, ...s }) => {
                                        const sceneEntity: SceneEntity = mapDomainSceneToInsertSceneDb({
                                            ...s,
                                            projectId: project.id,
                                            locationId: mapReferenceIdsToIds(locations, [ s.locationReferenceId ])[ 0 ],
                                        });
                                        const characterIds: string[] = mapReferenceIdsToIds(characters, characterReferenceIds);
                                        return Scene.parse({
                                            ...sceneEntity,
                                            characterReferenceIds,
                                            characterIds
                                        });
                                    });

                                    await this.projectRepository.createScenes(project.id, scenes);

                                    const updateMetadata: ProjectMetadata = { ...project.metadata, ...data.storyboardAttributes.metadata };
                                    const storyboard: Storyboard = {
                                        ...data.storyboardAttributes,
                                        metadata: updateMetadata,
                                        scenes,
                                        characters,
                                        locations,
                                    };

                                    saveAssets({ projectId: project.id }, 'storyboard', 'text', [ JSON.stringify(storyboard) ], { model: metadata.model });

                                    project = mapDbProjectToDomain({ ...project, metadata: updateMetadata, storyboard, scenes, characters, locations });
                                    const updated = await this.projectRepository.updateProject(project.id, project);

                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);

                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (generateError: any) {
                                console.error({ error: generateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to generate storyboard");
                                throw new Error(`Failed to generate: ${generateError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "PROCESS_AUDIO_TO_SCENES": {
                        try {
                            let project = await this.projectRepository.getProject(job.projectId);
                            if (!project?.metadata.enhancedPrompt) throw new Error("No enhanced prompt available");
                            if (!project?.metadata.audioPublicUri) throw new Error("No audio public url available");

                            try {
                                let { data, metadata } = await agents.audioProcessingAgent.processAudioToScenes(
                                    project.metadata.audioPublicUri,
                                    project.metadata.enhancedPrompt,
                                );

                                try {
                                    const { segments, ...analysisData } = data.analysis;

                                    saveAssets({ projectId: project.id }, "audio_analysis", 'text', [ JSON.stringify(data.analysis) ], { model: metadata.model });

                                    const projectMetadata: ProjectMetadata = { ...project.metadata, ...analysisData };
                                    const storyboard: Storyboard = { metadata: projectMetadata, scenes: [], characters: [], locations: [] };

                                    project = { ...project, status: "pending", metadata: projectMetadata, storyboard, audioAnalysis: data.analysis };

                                    const updated = await this.projectRepository.updateProject(job.projectId, project);
                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);

                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (processError: any) {
                                console.error({ error: processError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to process audio");
                                throw new Error(`Failed to process: ${processError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "ENHANCE_STORYBOARD": {
                        try {
                            let project = await this.projectRepository.getProject(job.projectId);
                            if (!project?.storyboard || !project.storyboard.scenes) throw new Error("No scenes available.");
                            if (!project?.metadata.enhancedPrompt) throw new Error("No enhanced prompt available.");

                            try {
                                let data: GenerativeResultEnhanceStoryboard[ 'data' ];
                                let metadata: GenerativeResultEnhanceStoryboard[ 'metadata' ];

                                if (project.metadata.hasAudio && project.audioAnalysis) {
                                    ({ data, metadata } = await agents.compositionalAgent.generateFullStoryboard(
                                        project.metadata.title,
                                        project.metadata.enhancedPrompt,
                                        project.audioAnalysis.segments,
                                        { initialDelay: 30000, attempt: job.attempt, maxRetries: job.maxRetries, projectId: job.projectId },
                                        saveAssets,
                                    ));
                                } else {
                                    ({ data, metadata } = await agents.compositionalAgent.generateFullStoryboard(
                                        project.metadata.title,
                                        project.metadata.enhancedPrompt,
                                        project.storyboard.scenes,
                                        { initialDelay: 30000, attempt: job.attempt, maxRetries: job.maxRetries, projectId: job.projectId },
                                        saveAssets,
                                    ));
                                }

                                try {
                                    const characters: Character[] = data.storyboardAttributes.characters.map((character) => mapDomainCharacterToInsertCharacterDb({
                                        ...character,
                                        projectId: project.id,
                                    }));
                                    const locations: Location[] = data.storyboardAttributes.locations.map((location) => mapDomainLocationToInsertLocationDb({
                                        ...location,
                                        projectId: project.id,
                                    }));
                                    const scenes: Scene[] = data.storyboardAttributes.scenes.map(({ characterReferenceIds, ...s }) => {
                                        const sceneEntity: SceneEntity = mapDomainSceneToInsertSceneDb({
                                            ...s,
                                            projectId: project.id,
                                            locationId: mapReferenceIdsToIds(locations, [ s.locationReferenceId ])[ 0 ],
                                        });
                                        const characterIds: string[] = mapReferenceIdsToIds(characters, characterReferenceIds);
                                        
                                        return Scene.parse({
                                            ...sceneEntity,
                                            characterReferenceIds,
                                            characterIds
                                        });
                                    });

                                    await this.projectRepository.createScenes(project.id, scenes);

                                    const updateMetadata: ProjectMetadata = { ...project.metadata, ...data.storyboardAttributes.metadata };
                                    const updatedStoryboard: Storyboard = { ...data.storyboardAttributes, characters, locations, scenes, metadata: updateMetadata };
                                    const fullProject: InsertProject = { ...project, storyboard: updatedStoryboard, metadata: updateMetadata, characters, locations, scenes };

                                    const updated = await this.projectRepository.updateProject(job.projectId, fullProject);

                                    await saveAssets({ projectId: project.id }, 'storyboard', 'text', [ JSON.stringify(updated.storyboard) ], { model: metadata.model });

                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);

                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (enhanceError: any) {
                                console.error({ error: enhanceError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to enhance storyboard");
                                throw new Error(`Failed to enhance: ${enhanceError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "SEMANTIC_ANALYSIS": {
                        try {
                            const project = await this.projectRepository.getProjectFullState(job.projectId);
                            if (!project?.storyboard) throw new Error("No storyboard available.");

                            try {
                                let { data, metadata } = await agents.semanticExpert.generateRules(project.storyboard);

                                try {
                                    const proactiveRules = (await import("../shared/prompts/generation-rules-presets.js")).getProactiveRules();
                                    const uniqueRules = Array.from(new Set([ ...proactiveRules, ...data.dynamicRules ]));

                                    project.generationRules = uniqueRules;
                                    project.generationRulesHistory.push(uniqueRules);

                                    const updated = await this.projectRepository.updateProject(job.projectId, project);
                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);

                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (analysisError: any) {
                                console.error({ error: analysisError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to generate rules");
                                throw new Error(`Failed to generate rules: ${analysisError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "GENERATE_CHARACTER_ASSETS": {
                        try {
                            const project = await this.projectRepository.getProjectFullState(job.projectId);
                            if (!project?.storyboard) throw new Error("No project storyboard available");

                            try {
                                let { data, metadata } = await agents.continuityAgent.generateCharacterAssets(
                                    project.characters,
                                    project.generationRules,
                                    saveAssets,
                                    createIncrementer(jobId),
                                );

                                try {
                                    const updated = await this.projectRepository.updateProject(job.projectId, { characters: data.characters });
                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);
                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (generateError: any) {
                                console.error({ error: generateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to generate character assets");
                                throw new Error(`Failed to generate: ${generateError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "GENERATE_LOCATION_ASSETS": {
                        try {
                            const project = await this.projectRepository.getProjectFullState(job.projectId);
                            if (!project?.storyboard) throw new Error("No project storyboard available");

                            try {
                                let { data, metadata } = await agents.continuityAgent.generateLocationAssets(
                                    project.locations,
                                    project.generationRules,
                                    saveAssets,
                                    createIncrementer(jobId),
                                );

                                try {
                                    const updated = await this.projectRepository.updateProject(job.projectId, { locations: data.locations });
                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);
                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (generateError: any) {
                                console.error({ error: generateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to generate location assets");
                                throw new Error(`Failed to generate: ${generateError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "GENERATE_SCENE_FRAMES": {
                        try {
                            const project = await this.projectRepository.getProjectFullState(job.projectId);
                            if (!project?.storyboard) throw new Error("No project storyboard available");

                            try {
                                let { data, metadata } = await agents.continuityAgent.generateSceneFramesBatch(
                                    project,
                                    job.assetKey as 'scene_start_frame' | 'scene_end_frame',
                                    saveAssets,
                                    updateScene,
                                    createIncrementer(jobId),
                                );

                                try {
                                    const updated = await this.projectRepository.updateProject(job.projectId, { scenes: data.updatedScenes });
                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);
                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (generateError: any) {
                                console.error({ error: generateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to generate scene frames");
                                throw new Error(`Failed to generate: ${generateError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "GENERATE_SCENE_VIDEO": {
                        try {
                            const project = await this.projectRepository.getProjectFullState(job.projectId);
                            if (!project.scenes[ job.payload.sceneIndex ]) throw new Error("No scene available");

                            try {
                                const scene = project.scenes[ job.payload.sceneIndex ]!;
                                const generateAudio = project.metadata.hasAudio;

                                const {
                                    enhancedPrompt,
                                    characterReferenceImages,
                                    locationReferenceImages,
                                    sceneCharacters,
                                    location,
                                    previousScene,
                                    generationRules,
                                } = await agents.continuityAgent.prepareAndRefineSceneInputs(scene, project, job.payload.overridePrompt, saveAssets);

                                const assets = scene.assets;
                                const startFrame = assets[ 'scene_start_frame' ]?.versions[ assets[ 'scene_start_frame' ]?.best ]?.data;
                                const endFrame = assets[ 'scene_end_frame' ]?.versions[ assets[ 'scene_end_frame' ]?.best ]?.data;

                                let { data, metadata } = await agents.sceneAgent.generateSceneWithQualityCheck({
                                    scene,
                                    enhancedPrompt,
                                    sceneCharacters,
                                    sceneLocation: location,
                                    previousScene,
                                    version: job.payload.version,
                                    startFrame: startFrame,
                                    endFrame: endFrame,
                                    characterReferenceImages,
                                    locationReferenceImages,
                                    generateAudio,
                                    saveAssets,
                                    updateScene,
                                    onAttempt: createIncrementer(jobId),
                                    saveMetric,
                                    generationRules
                                });

                                try {
                                    const updatedProject = agents.continuityAgent.updateNarrativeState(data.scene, project);

                                    if (metadata.evaluation) {
                                        updatedProject.generationRules = Array.from(new Set(...updatedProject.generationRules, ...extractGenerationRules([ metadata.evaluation ])));
                                    }

                                    const forceRegenerateIndex = project?.forceRegenerateSceneIds.findIndex(id => id === scene.id);
                                    updatedProject.forceRegenerateSceneIds = project.forceRegenerateSceneIds.slice(0, forceRegenerateIndex).concat(project.forceRegenerateSceneIds.slice(forceRegenerateIndex + 1));

                                    const updated = await this.projectRepository.updateProject(job.projectId, updatedProject);

                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);

                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (generateError: any) {
                                console.error({ error: generateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to generate scene video");
                                throw new Error(`Failed to generate: ${generateError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "RENDER_VIDEO": {
                        try {
                            let renderedVideo;
                            try {
                                if (job.payload.audioGcsUri) {
                                    renderedVideo = await agents.audioProcessingAgent.mediaController.stitchScenes(job.payload.videoPaths, job.projectId, job.attempt, job.payload.audioGcsUri);
                                } else {
                                    renderedVideo = await agents.audioProcessingAgent.mediaController.stitchScenes(job.payload.videoPaths, job.projectId, job.attempt);
                                }

                                try {
                                    let data = { renderedVideo };
                                    let metadata = { model: videoModelName, attempts: 1, acceptedAttempt: 1 };

                                    saveAssets({ projectId: job.projectId }, 'render_video', 'video', [ renderedVideo ], metadata);

                                    const updated = await this.projectRepository.getProjectFullState(job.projectId);
                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);

                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to finalize video render");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (renderError: any) {
                                console.error({ error: renderError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to stitch scenes");
                                throw new Error(`Failed to render: ${renderError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    case "FRAME_RENDER": {
                        try {
                            let payload = job.payload;
                            try {
                                await agents.frameCompositionAgent.generateImage(
                                    payload.scene,
                                    payload.prompt,
                                    payload.framePosition,
                                    payload.sceneCharacters,
                                    payload.sceneLocations,
                                    payload.previousFrame,
                                    payload.referenceImages,
                                    saveAssets,
                                    updateScene,
                                    createIncrementer(jobId),
                                );

                                try {
                                    const updated = await this.projectRepository.getProjectFullState(job.projectId);
                                    await this.jobControlPlane.updateJobSafe(jobId, job.attempt, { state: "COMPLETED" });
                                    this.publishStateUpdate(updated);
                                } catch (updateError: any) {
                                    console.error({ error: updateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to update project state");
                                    throw new Error(`Failed to update project: ${updateError.message}`);
                                }
                            } catch (generateError: any) {
                                console.error({ error: generateError, jobType: job.type, jobId, projectId: job.projectId }, "Failed to generate frame image");
                                throw new Error(`Failed to generate: ${generateError.message}`);
                            }
                        } catch (caseError: any) {
                            console.error({ error: caseError, jobType: job.type, jobId, projectId: job.projectId }, "Job case failed");
                            throw caseError;
                        }
                        break;
                    }

                    default:
                        throw new Error(`Unknown job type: ${JSON.stringify(job)}`);
                }

                const endTime = Date.now();
                const durationMs = endTime - startTime;
                this.publishJobEvent({ type: "JOB_COMPLETED", jobId, projectId: job.projectId });

                console.log({ job, durationMs }, `Job completed in ${durationMs / 1000}s`);

            } catch (error: any) {
                console.error({
                    error: {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,  // Add this!
                        ...(error.cause && { cause: error.cause }), // Include cause if present
                    },
                    job,
                    jobType: job.type,  // Make it easier to identify which case failed
                }, "Execution failed");

                await this.jobControlPlane.updateJobSafeAndIncrementAttempt(jobId, job.attempt, { state: "FAILED", error: (error.message as string).slice(0, 80), attempt: job.attempt + 1 });
                await this.publishJobEvent({
                    type: "JOB_FAILED", jobId, error: `${error.name}: ${error.message}`.slice(0, 200),
                });
            }
        });
    }
}
