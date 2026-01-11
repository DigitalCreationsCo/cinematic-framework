// src/workflow/graph.ts
import * as dotenv from "dotenv";
dotenv.config();
import { StateGraph, END, START, NodeInterrupt } from "@langchain/langgraph";
import { JobControlPlane } from "../pipeline/services/job-control-plane";
import { PoolManager } from "../pipeline/services/pool-manager";
import { JobEvent, JobRecord, JobType } from "../shared/types/job-types";
import {
  InitialProject,
  InitialProjectSchema,
  LlmRetryInterruptValue,
  Project,
  Scene,
  WorkflowState,
} from "../shared/types/pipeline.types";
import { PipelineEvent } from "../shared/types/pubsub.types";
import { z } from "zod";
import { GCPStorageManager } from "./storage-manager";
import { TextModelController } from "./llm/text-model-controller";
import { VideoModelController } from "./llm/video-model-controller";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { imageModelName, qualityCheckModelName, textModelName, videoModelName } from "./llm/google/models";
import { deleteBogusUrlsStoryboard, getAllBestFromAssets } from "../shared/utils/utils";
import { QualityCheckAgent } from "./agents/quality-check-agent";
import { CheckpointerManager } from "./checkpointer-manager";
import { RunnableConfig } from "@langchain/core/runnables";
import { ProjectRepository } from "../pipeline/project-repository";
import { AudioProcessingAgent } from "./agents/audio-processing-agent";
import { CompositionalAgent } from "./agents/compositional-agent";
import { FrameCompositionAgent } from "./agents/frame-composition-agent";
import { SceneGeneratorAgent } from "./agents/scene-generator";
import { ContinuityManagerAgent } from "./agents/continuity-manager";
import { SemanticExpertAgent } from "./agents/semantic-expert-agent";
import { PubSub } from "@google-cloud/pubsub";
import { JOB_EVENTS_TOPIC_NAME } from "@shared/constants";
import { AssetVersionManager } from "./asset-version-manager";
import { interceptNodeInterruptAndThrow } from "../shared/utils/errors";
import { MediaController } from "./media-controller";
import { extractGenerationRules } from "./prompts/prompt-composer";



// ============================================================================
// CINEMATIC VIDEO FRAMEWORK - TypeScript Implementation
// Google Vertex AI + LangGraph + GCP Storage
// ============================================================================

export class CinematicVideoWorkflow {
  public graph: StateGraph<WorkflowState>;
  private storageManager: GCPStorageManager;
  private jobControlPlane: JobControlPlane;
  private projectRepository: ProjectRepository;
  private assetManager: AssetVersionManager;

  private audioProcessingAgent: AudioProcessingAgent;
  private compositionalAgent: CompositionalAgent;
  private qualityAgent: QualityCheckAgent;
  private semanticExpert: SemanticExpertAgent;
  private frameCompositionAgent: FrameCompositionAgent;
  private sceneAgent: SceneGeneratorAgent;
  private continuityAgent: ContinuityManagerAgent;

  private gcpProjectId: string;
  private projectId: string;
  private bucketName: string;
  private controller?: AbortController;

  private MAX_PARALLEL_JOBS: number;
  private MAX_RETRIES: number;

  constructor(
    { gcpProjectId,
      projectId,
      bucketName,
      jobControlPlane,
      controller,
      location = "us-east1",
    }:
      {
        gcpProjectId: string;
        projectId: string;
        bucketName: string;
        jobControlPlane: JobControlPlane;
        controller?: AbortController;
        location?: string;
      }
  ) {

    if (!gcpProjectId) throw Error("A gcpProjectId was not provided");
    if (!bucketName) throw Error("A bucket name was not provided");

    this.gcpProjectId = gcpProjectId;
    this.projectId = projectId;
    this.bucketName = bucketName;
    this.controller = controller;
    this.storageManager = new GCPStorageManager(this.gcpProjectId, this.projectId, this.bucketName);
    this.jobControlPlane = jobControlPlane;
    this.projectRepository = new ProjectRepository();
    this.assetManager = new AssetVersionManager(this.projectRepository);

    const textandImageModel = new TextModelController('google');
    const videoModel = new VideoModelController('google');
    const agentOptions = { signal: this.controller?.signal };

    this.audioProcessingAgent = new AudioProcessingAgent(
      textandImageModel,
      this.storageManager,
      new MediaController(this.storageManager),
      agentOptions
    );

    this.compositionalAgent = new CompositionalAgent(textandImageModel, this.storageManager, this.assetManager, agentOptions);

    this.qualityAgent = new QualityCheckAgent(textandImageModel, this.storageManager, agentOptions);

    this.semanticExpert = new SemanticExpertAgent(textandImageModel);

    this.frameCompositionAgent = new FrameCompositionAgent(
      textandImageModel,
      textandImageModel,
      this.qualityAgent,
      this.storageManager,
      this.assetManager,
      agentOptions
    );

    this.sceneAgent = new SceneGeneratorAgent(
      videoModel,
      this.qualityAgent,
      this.storageManager,
      this.assetManager,
      agentOptions
    );

    this.continuityAgent = new ContinuityManagerAgent(
      textandImageModel,
      textandImageModel,
      this.frameCompositionAgent,
      this.qualityAgent,
      this.storageManager,
      this.assetManager,
      agentOptions
    );

    this.MAX_PARALLEL_JOBS = Number(process.env.MAX_PARALLEL_JOBS) || 2;
    this.MAX_RETRIES = this.qualityAgent.qualityConfig.maxRetries;

    this.graph = this.buildGraph();
  }

  public publishEvent: (event: PipelineEvent) => Promise<void> = async () => { };

  private async publishStateUpdate(project: Project, nodeName: string) {
    await this.publishEvent({
      type: "FULL_STATE",
      projectId: this.projectId,
      payload: { project },
      timestamp: new Date().toISOString(),
    });
    console.log(`✓ Updated project after ${nodeName}`);
  }

  private async ensureJob<T extends JobType>(
    nodeName: string,
    jobType: T,
    payload: Extract<JobRecord, { type: T; }>[ 'payload' ],
    attempt: number,
  ): Promise<Extract<JobRecord, { type: T; }>[ 'result' ]> {

    const jobId = await this.jobControlPlane.jobId(this.projectId, nodeName, attempt);
    const job = await this.jobControlPlane.getJob(jobId) as Extract<JobRecord, { type: T; }>;
    if (!job) {
      await this.jobControlPlane.createJob({
        id: jobId,
        type: jobType,
        projectId: this.projectId,
        payload,
        retryCount: attempt,
        maxRetries: this.MAX_RETRIES,
      });
      console.log(`[${nodeName}] Dispatched job ${jobId}`);
      throw new NodeInterrupt({ reason: "waiting_for_job", jobId });
    }

    if (job.state === 'COMPLETED') {
      const result = job.result;
      console.error(`Job ${job.id} complete but no result was returned.`, { job });
      if (!result) throw new Error(`Job ${job.id} complete but no result was returned.`);
      return result as any;
    }

    if (job.state === 'FAILED') {
      throw new Error(`Job ${jobId} failed: ${job.error}`);
    }

    console.log(`[${nodeName}] Waiting for job ${jobId} (State: ${job.state})`);
    throw new NodeInterrupt({ reason: "waiting_for_job", jobId });
  }

  private async ensureBatchJobs<T extends JobType>(
    nodeName: string,
    jobs: { id: string; type: T; payload: Extract<JobRecord, { type: T; }>[ 'payload' ]; retryCount?: number; }[],
  ): Promise<NonNullable<Extract<JobRecord, { type: T; }>[ 'result' ]>[]> {

    const results: NonNullable<Extract<JobRecord, { type: T; }>[ 'result' ]>[] = [];
    const missingJobs: typeof jobs = [];
    const failedJobs: { id: string; error: string; }[] = [];
    let runningCount = 0;

    // 1. Check status of all requested jobs
    for (const jobRequest of jobs) {
      const job = await this.jobControlPlane.getJob(jobRequest.id);

      if (!job) {
        missingJobs.push(jobRequest);
      } else if (job.state === 'COMPLETED') {
        if (!job.result) throw new Error(`Job ${job.id} has no result object`);
        results.push(job.result as any);
      } else if (job.state === 'FAILED') {
        failedJobs.push({ id: job.id, error: job.error || "Unknown error" });
      } else {
        // PENDING or RUNNING
        runningCount++;
      }
    }

    // 2. Handle Aggregated Failures
    if (failedJobs.length > 0) {
      const errorMsg = `${failedJobs.length} jobs failed in batch: ${failedJobs.map(f => f.id).join(', ')}`;
      console.error(`[${nodeName}] ${errorMsg}`);

      // aggregated failure interrupt
      const interruptValue: LlmRetryInterruptValue = {
        type: "llm_retry_exhausted",
        error: errorMsg,
        errorDetails: {
          failedJobs
        },
        functionName: "ensureBatchJobs",
        nodeName: nodeName,
        params: {
          jobIds: failedJobs.map(f => f.id)
        }
      };

      throw new NodeInterrupt(interruptValue);
    }

    // 3. Throttling & Creation
    const slotsAvailable = this.MAX_PARALLEL_JOBS - runningCount;

    if (missingJobs.length > 0) {
      // Only start as many as we have slots for
      const jobsToStart = missingJobs.slice(0, slotsAvailable);

      if (jobsToStart.length > 0) {
        console.log(`[${nodeName}] Starting ${jobsToStart.length} new jobs (Throttling: ${runningCount}/${this.MAX_PARALLEL_JOBS} active)`);

        for (const jobRequest of jobsToStart) {
          await this.jobControlPlane.createJob({
            ...jobRequest,
            projectId: this.projectId,
            maxRetries: 3,
            retryCount: jobRequest.retryCount
          });
          runningCount++;
        }
      }
    }

    // 4. Wait if any are running or if we still have missing jobs (queued)
    const notCompletedCount = jobs.length - results.length;

    if (notCompletedCount > 0) {
      console.log(`[${nodeName}] Waiting for ${notCompletedCount} jobs (${runningCount} running, ${jobs.length - results.length - runningCount} pending start)...`);
      throw new NodeInterrupt({ reason: "waiting_for_batch", pendingJobs: notCompletedCount });
    }

    return results as any;
  }

  private buildGraph(): StateGraph<WorkflowState> {
    const workflow = new StateGraph<WorkflowState>({
      channels: {
        id: null,
        projectId: null,
        hasAudio: null,
        localAudioPath: null,
        currentSceneIndex: null,
        jobIds: {
          reducer: (x, y) => ({ ...x, ...y }),
          default: () => ({}),
        },
        errors: {
          reducer: (x, y) => [ ...x, ...y ],
          default: () => [],
        },
        __interrupt__: null,
        __interrupt_resolved__: null,
      },
    });

    workflow.addNode("expand_creative_prompt", async (state: WorkflowState) => {
      const nodeName = "expand_creative_prompt";
      const project = await this.projectRepository.getProject(state.projectId);
      if (!project.metadata.initialPrompt) throw new Error("No user prompt provided");

      const [ version ] = await this.assetManager.getNextVersionNumber(
        { projectId: this.projectId }, 'enhanced_prompt',
      );
      try {
        const result = await this.ensureJob(
          nodeName,
          "EXPAND_CREATIVE_PROMPT",
          {
            initialPrompt: project.metadata.initialPrompt,
            title: project.metadata.title,
          },
          version
        );
        const { expandedPrompt } = result!;
        console.log(`   ✓ Expanded to ${expandedPrompt.length} characters of cinematic detail`);

        const updated = await this.projectRepository.updateProject(state.projectId, {
          metadata: { enhancedPrompt: expandedPrompt }
        } as any);
        await this.publishStateUpdate(updated, nodeName);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error) {
        console.error(`[${nodeName}] error`, { error });
        interceptNodeInterruptAndThrow(error, nodeName);
      }
    });

    workflow.addNode("generate_storyboard_exclusively_from_prompt", async (state: WorkflowState) => {
      const nodeName = "generate_storyboard_exclusively_from_prompt";
      const project = await this.projectRepository.getProject(state.projectId);

      try {
        const [ version ] = await this.assetManager.getNextVersionNumber(
          { projectId: this.projectId }, 'storyboard',
        );
        const result = await this.ensureJob(
          nodeName,
          "GENERATE_STORYBOARD",
          {
            title: project.metadata.title,
            enhancedPrompt: project.metadata.enhancedPrompt!
          },
          version,
        );
        const { storyboard } = result!;
        const cleaned = deleteBogusUrlsStoryboard(storyboard);

        await this.projectRepository.createScenes(state.projectId, cleaned.scenes);
        await this.projectRepository.createCharacters(state.projectId, cleaned.characters);
        await this.projectRepository.createLocations(state.projectId, cleaned.locations);
        this.assetManager.createVersionedAssets(
          { projectId: this.projectId },
          'storyboard',
          'text',
          [ JSON.stringify(storyboard) ],
          { model: textModelName }
        );
        const updated = await this.projectRepository.getProjectFullState(this.projectId);
        await this.publishStateUpdate(updated, nodeName);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error) {
        console.error(`[${nodeName}] error`, { error });
        interceptNodeInterruptAndThrow(error, nodeName);
      }
    });

    workflow.addNode("create_scenes_from_audio", async (state: WorkflowState) => {
      const nodeName = "create_scenes_from_audio";
      const project = await this.projectRepository.getProject(state.projectId);
      if (!project.metadata.enhancedPrompt) throw new Error("No creative prompt available");
      if (!project.metadata.audioPublicUri) throw new Error("No audio public url available");

      console.log(" Creating Timed Scenes from Audio...");
      try {
        const [ version ] = await this.assetManager.getNextVersionNumber(
          { projectId: this.projectId }, 'scenes',
        );
        const result = await this.ensureJob(
          nodeName,
          "PROCESS_AUDIO_TO_SCENES",
          {
            audioPublicUri: project.metadata.audioPublicUri,
            enhancedPrompt: project.metadata.enhancedPrompt,
          },
          version
        );
        const { segments, totalDuration } = result!;
        const metadata = {
          ...project.metadata,
          duration: totalDuration,
        };

        let update = {
          metadata,
          scenes: segments as Scene[],
          characters: [],
          locations: [],
          storyboard: {
            metadata,
            scenes: segments as Scene[],
            characters: [],
            locations: [],
          },
          status: "pending",
        } as unknown as Project;
        update = deleteBogusUrlsStoryboard(update) as Project;
        const updated = await this.projectRepository.updateProject(state.projectId, update);
        this.assetManager.createVersionedAssets(
          { projectId: this.projectId },
          'storyboard',
          'text',
          [ JSON.stringify(updated.storyboard) ],
          { model: textModelName }
        );
        await this.publishStateUpdate(updated, nodeName);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        console.error(`[${nodeName}] error`, { error });
        interceptNodeInterruptAndThrow(error, nodeName);
      }
    });

    workflow.addNode("enrich_storyboard_and_scenes", async (state: WorkflowState) => {
      const nodeName = "enrich_storyboard_and_scenes";
      const project = await this.projectRepository.getProject(state.projectId);
      if (!project.storyboard || !project.storyboard.scenes) throw new Error("No scenes available.");
      if (!project.metadata.enhancedPrompt) throw new Error("No enhanced prompt available.");

      console.log(" Enhancing storyboard...");
      try {
        const [ version ] = await this.assetManager.getNextVersionNumber(
          { projectId: this.projectId }, 'storyboard',
        );
        const result = await this.ensureJob(
          nodeName,
          "ENHANCE_STORYBOARD",
          {
            storyboard: project.storyboard,
            enhancedPrompt: project.metadata.enhancedPrompt
          },
          version
        );
        const { storyboard: rawStoryboard } = result!;
        const storyboard = deleteBogusUrlsStoryboard(rawStoryboard as any);

        let update = {
          status: "pending",
          metadata: storyboard.metadata,
          scenes: storyboard.scenes,
          characters: storyboard.characters,
          locations: storyboard.locations,
          storyboard: {
            metadata: storyboard.metadata,
            scenes: storyboard.scenes,
            characters: storyboard.characters,
            locations: storyboard.locations,
          },
        } as unknown as Project;
        await this.projectRepository.createScenes(state.projectId, update.scenes);
        await this.projectRepository.createCharacters(state.projectId, update.characters);
        await this.projectRepository.createLocations(state.projectId, update.locations);
        const updated = await this.projectRepository.updateProject(state.projectId, update);
        this.assetManager.createVersionedAssets(
          { projectId: this.projectId },
          'storyboard',
          'text',
          [ JSON.stringify(storyboard) ],
          { model: textModelName }
        );
        await this.publishStateUpdate(updated, nodeName);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error) {
        console.error(`[${nodeName}] error`, { error });
        interceptNodeInterruptAndThrow(error, nodeName);
      }
    });

    workflow.addNode("generate_character_assets", async (state: WorkflowState) => {
      const nodeName = "generate_character_assets";
      let project = await this.projectRepository.getProject(state.projectId);
      if (!project.storyboard) throw new Error("No project state available");

      console.log(" Generating Character References...");
      try {
        const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
        console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);

        const characters = project.storyboard.characters;

        if (executionMode === 'SEQUENTIAL') {
          const [ version ] = await this.assetManager.getNextVersionNumber(
            { projectId: this.projectId }, 'character_image',
          );
          const result = await this.ensureJob(
            nodeName,
            "GENERATE_CHARACTER_ASSETS",
            {
              characters: characters,
              generationRules: project.generationRules,
            },
            version
          );
          const { characters: updatedChars } = result!;

          const updated = await this.projectRepository.updateCharacters(updatedChars);
          const characterIds: string[] = [];
          const characterImageUris: string[] = [];
          updated.forEach((char) => {
            characterIds.push(char.id);
            const assets = getAllBestFromAssets(char.assets);
            characterImageUris.push(assets[ 'character_image' ]?.data || "");
          });
          if (characterIds.length > 0) {
            await this.assetManager.createVersionedAssets(
              { projectId: this.projectId, characterIds },
              'character_image',
              'image',
              characterImageUris,
              { model: imageModelName }
            );
          }
          let updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(updatedProject, nodeName);
        } else {
          // Parallel logic (fan-out)
          const characterIds = characters.map(c => c.id);
          const nextVersions = await this.assetManager.getNextVersionNumber(
            { projectId: this.projectId, characterIds }, 'character_image'
          );
          const jobs = characters.map((char, index) => ({
            id: `${this.projectId}-char-${char.id}-${nextVersions[ index ]}`,
            type: "GENERATE_CHARACTER_ASSETS" as const,
            payload: {
              characters: [ char ],
              generationRules: project.generationRules
            },
            retryCount: nextVersions[ index ]
          }));

          const results = await this.ensureBatchJobs(nodeName, jobs);
          const allUpdatedChars = results.flatMap(r => r.characters);
          const updated = await this.projectRepository.updateCharacters(allUpdatedChars);

          const validIds: string[] = [];
          const validUris: string[] = [];
          const charMap = new Map(updated.map(c => [ c.id, c ]));
          characters.forEach(c => {
            const updatedChar = charMap.get(c.id);
            const assets = getAllBestFromAssets(updatedChar?.assets);
            if (updatedChar && assets[ 'character_image' ]?.data) {
              validIds.push(updatedChar.id);
              validUris.push(assets[ 'character_image' ].data);
            }
          });
          if (validIds.length > 0) {
            await this.assetManager.createVersionedAssets(
              { projectId: this.projectId, characterIds: validIds },
              'character_image',
              'image',
              validUris,
              { model: imageModelName }
            );
          }
          let updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(updatedProject, nodeName);
        }

        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error) {
        console.error(`[${nodeName}] error`, { error });
        interceptNodeInterruptAndThrow(error, nodeName);
      }
    });

    workflow.addNode("generate_location_assets", async (state: WorkflowState) => {
      const nodeName = "generate_location_assets";
      let project = await this.projectRepository.getProject(state.projectId);
      if (!project.storyboard) throw new Error("No project state available");

      console.log(" Generating Location References...");
      try {
        const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
        console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);
        const locations = project.storyboard.locations;
        const locationIds = locations.map(loc => loc.id);

        if (executionMode === 'SEQUENTIAL') {
          const [ version ] = await this.assetManager.getNextVersionNumber(
            { projectId: this.projectId, locationIds }, 'location_image',
          );
          const result = await this.ensureJob(
            nodeName,
            "GENERATE_LOCATION_ASSETS",
            {
              locations: locations,
              generationRules: project.generationRules,
            },
            version
          );
          const { locations: updatedLocs } = result!;

          const updated = await this.projectRepository.updateLocations(updatedLocs);
          const locationImageUris: string[] = [];
          updated.forEach((loc) => {
            const assets = getAllBestFromAssets(loc.assets);
            if (assets[ 'location_image' ]?.data) {
              locationImageUris.push(assets[ 'location_image' ].data);
            }
          });
          if (locationIds.length > 0 && locationImageUris.length > 0) {
            await this.assetManager.createVersionedAssets(
              { projectId: this.projectId, locationIds },
              'location_image',
              'image',
              locationImageUris,
              { model: imageModelName }
            );
          }
          let updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(updatedProject, nodeName);
        } else {

          const nextVersions = await this.assetManager.getNextVersionNumber(
            { projectId: this.projectId, locationIds }, 'location_image'
          );
          const jobs = locations.map((loc, index) => ({
            id: `${this.projectId}-loc-${loc.id}-${nextVersions[ index ]}`,
            type: "GENERATE_LOCATION_ASSETS" as const,
            payload: {
              locations: [ loc ],
              generationRules: project.generationRules
            },
            retryCount: nextVersions[ index ]
          }));

          const results = await this.ensureBatchJobs(nodeName, jobs);
          const allUpdatedLocs = results.flatMap(r => r.locations);
          const updated = await this.projectRepository.updateLocations(allUpdatedLocs);
          const validIds: string[] = [];
          const validUris: string[] = [];
          const locMap = new Map(updated.map(l => [ l.id, l ]));
          locations.forEach(l => {
            const updatedLoc = locMap.get(l.id);
            const assets = getAllBestFromAssets(updatedLoc?.assets);
            if (updatedLoc && assets[ 'location_image' ]?.data) {
              validIds.push(updatedLoc.id);
              validUris.push(assets[ 'location_image' ].data);
            }
          });
          if (validIds.length > 0) {
            await this.assetManager.createVersionedAssets(
              { projectId: this.projectId, locationIds: validIds },
              'location_image',
              'image',
              validUris,
              { model: imageModelName }
            );
          }
          let updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(updatedProject, nodeName);
        }
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error) {
        console.error(`[${nodeName}] error`, { error });
        interceptNodeInterruptAndThrow(error, nodeName);
      }
    });

    workflow.addNode("generate_scene_assets", async (state: WorkflowState) => {
      const nodeName = "generate_scene_assets";
      let project = await this.projectRepository.getProject(state.projectId);
      if (!project.storyboard) throw new Error("No project state available");

      console.log(" Generating Scene Reference Images...");
      try {
        const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
        console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);
        const scenes = await this.projectRepository.getProjectScenes(state.projectId);

        if (executionMode === 'SEQUENTIAL') {
          for (const scene of scenes) {
            const [ version ] = await this.assetManager.getNextVersionNumber(
              { projectId: this.projectId, sceneId: scene.id }, 'start_frame_prompt'
            );

            const result = await this.ensureJob(
              nodeName,
              "GENERATE_SCENE_FRAMES",
              {
                sceneId: scene.id,
                sceneIndex: scene.sceneIndex
              },
              version
            );

            if (result!.updatedScenes && result!.updatedScenes.length > 0) {
              await this.projectRepository.updateScenes(result!.updatedScenes);
            }
          }
        } else {

          const jobs = await Promise.all(scenes.map(async (scene) => {
            const [ version ] = await this.assetManager.getNextVersionNumber(
              { projectId: this.projectId, sceneId: scene.id }, 'start_frame_prompt'
            );
            return {
              id: `${this.projectId}-scene-frames-${scene.id}-${version}`,
              type: "GENERATE_SCENE_FRAMES" as const,
              payload: {
                sceneId: scene.id,
                sceneIndex: scene.sceneIndex
              },
              retryCount: version
            };
          }));

          const results = await this.ensureBatchJobs(nodeName, jobs);

          const allUpdatedScenes = results.flatMap(r => r.updatedScenes);
          await this.projectRepository.updateScenes(allUpdatedScenes);
        }

        let project = await this.projectRepository.getProjectFullState(state.projectId);
        await this.publishStateUpdate(project, nodeName);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };

      } catch (error) {
        console.error(`[${nodeName}] error`, { error });
        interceptNodeInterruptAndThrow(error, nodeName);
      }
    });

    workflow.addNode("process_scene", async (state: WorkflowState) => {

      const nodeName = "process_scene";
      const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
      console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);
      let project = await this.projectRepository.getProjectFullState(state.projectId);
      const { scenes } = project;

      if (executionMode === 'SEQUENTIAL') {
        const index = state.currentSceneIndex;
        if (index >= scenes.length) return state;

        const scene = scenes[ index ];
        const nextScene = scenes[ index + 1 ];
        const [ best ] = await this.assetManager.getBestVersion({ projectId: this.projectId, sceneId: scene.id }, 'scene_video');
        const videoUrl = best ? scene.assets[ 'scene_video' ]?.versions[ best.version ].data : null;
        const forceRegenerateIndex = project.forceRegenerateSceneIds.findIndex(id => id === scene.id);
        const shouldForceRegenerate = forceRegenerateIndex !== -1;
        if (!shouldForceRegenerate && videoUrl && await this.storageManager.fileExists(videoUrl)) {
          console.log(`   ... Scene video already exists at ${videoUrl}, skipping.`);
          await this.publishEvent({
            type: "SCENE_SKIPPED",
            projectId: this.projectId,
            payload: {
              sceneId: scene.id,
              reason: "Video already exists",
              videoUrl: videoUrl
            },
            timestamp: new Date().toISOString(),
          });

          let shouldRenderScenes = false;
          const [ nextSceneBest ] = await this.assetManager.getBestVersion({ projectId: this.projectId, sceneId: nextScene.id }, 'scene_video');
          const nextScenePath = nextSceneBest ? await this.storageManager.getObjectPath({ type: "scene_video", sceneId: nextScene.id, attempt: nextSceneBest.version }) : "";
          const nextExists = await this.storageManager.fileExists(nextScenePath);
          if (!nextExists) {
            shouldRenderScenes = true;
          } else {
            console.log(` ... Next scene (${nextScene.id}) also exists, skipping redundant stitch.`);
          }
          if (!shouldRenderScenes) {
            const renderedVideo = await this.audioProcessingAgent.mediaController.performIncrementalVideoRender(scenes, project.metadata.audioGcsUri, this.projectId, 1);
            if (renderedVideo) { this.assetManager.createVersionedAssets({ projectId: this.projectId }, 'render_video', 'video', [ renderedVideo ], { model: videoModelName }); }
          }

          project.forceRegenerateSceneIds = project.forceRegenerateSceneIds.slice(0, forceRegenerateIndex).concat(project.forceRegenerateSceneIds.slice(forceRegenerateIndex + 1));
          const updated = await this.projectRepository.updateProject(this.projectId, project);
          await this.publishStateUpdate(updated, "process_scene");

          return {
            ...state,
            currentSceneIndex: state.currentSceneIndex + 1,
            __interrupt__: undefined,
            __interrupt_resolved__: false,
          };
        }

        console.log(`[${nodeName}]: Processing scene ${scene.sceneIndex} (${index + 1}/${scenes.length}).`);
        const [ next ] = await this.assetManager.getNextVersionNumber({ projectId: this.projectId, sceneId: scene.id }, 'scene_video');
        const result = await this.ensureJob(
          nodeName,
          "GENERATE_SCENE_VIDEO",
          {
            sceneId: scene.id,
            sceneIndex: scene.sceneIndex,
            attempt: next,
          },
          next
        );
        const { scene: generatedScene, acceptedAttempt, evaluation } = result!;

        await this.assetManager.createVersionedAssets(
          { projectId: this.projectId, sceneId: scene.id },
          'scene_video',
          'video',
          [ generatedScene.assets[ 'scene_video' ]?.versions[ acceptedAttempt ].data! ],
          { model: videoModelName, evaluation },
          true
        );

        await this.projectRepository.updateScenes([ generatedScene ]);
        project = this.continuityAgent.updateNarrativeState(generatedScene, project);
        if (evaluation) { project.generationRules = Array.from(new Set(...project.generationRules, ...extractGenerationRules([ evaluation ]))); }
        project.forceRegenerateSceneIds = project.forceRegenerateSceneIds.slice(0, forceRegenerateIndex).concat(project.forceRegenerateSceneIds.slice(forceRegenerateIndex + 1));
        const updated = await this.projectRepository.updateProject(this.projectId, project);
        await this.publishStateUpdate(updated, nodeName);

        return {
          ...state,
          currentSceneIndex: index + 1,
        };
      } else {

        // Parallel logic (fan-out)
        const jobs: {
          id: string;
          type: "GENERATE_SCENE_VIDEO";
          payload: { sceneIndex: number; sceneId: string; attempt: number; };
          retryCount: number;
        }[] = [];

        await Promise.all(scenes.map(async (scene) => {
          const forceRegenerateIndex = project.forceRegenerateSceneIds.findIndex(id => id === scene.id);
          const shouldForceRegenerate = forceRegenerateIndex !== -1;

          let videoExists = false;
          if (!shouldForceRegenerate) {
            const [ best ] = await this.assetManager.getBestVersion({ projectId: this.projectId, sceneId: scene.id }, 'scene_video');
            const videoUrl = best?.data;
            if (videoUrl && await this.storageManager.fileExists(videoUrl)) {
              videoExists = true;
              console.log(`   ... Scene ${scene.id} video already exists, skipping.`);
            }
          }

          if (shouldForceRegenerate || !videoExists) {
            const [ nextVersion ] = await this.assetManager.getNextVersionNumber({ projectId: this.projectId, sceneId: scene.id }, "scene_video");
            jobs.push({
              id: `${this.projectId}-scene-video-${scene.id}-${nextVersion}`,
              type: "GENERATE_SCENE_VIDEO" as const,
              payload: {
                sceneIndex: scene.sceneIndex,
                sceneId: scene.id,
                attempt: nextVersion,
              },
              retryCount: nextVersion,
            });
          }
        }));

        try {
          if (jobs.length > 0) {
            const results = await this.ensureBatchJobs(
              nodeName,
              jobs,
            );

            const generatedSceneIds: string[] = [];
            for (const res of results) {
              const { scene: generatedScene, evaluation, acceptedAttempt } = res;
              await this.assetManager.createVersionedAssets(
                { projectId: this.projectId, sceneId: generatedScene.id },
                'scene_video',
                'video',
                [ generatedScene.assets[ 'scene_video' ]?.versions[ acceptedAttempt ].data! ],
                {
                  model: videoModelName,
                  evaluation
                },
                true
              );
              await this.projectRepository.updateScenes([ generatedScene ]);
              generatedSceneIds.push(generatedScene.id);
            }

            // Update forceRegenerateSceneIds
            if (generatedSceneIds.length > 0) {
              const currentProject = await this.projectRepository.getProject(this.projectId);
              const newForceList = currentProject.forceRegenerateSceneIds.filter(id => !generatedSceneIds.includes(id));

              if (newForceList.length !== currentProject.forceRegenerateSceneIds.length) {
                await this.projectRepository.updateProject(this.projectId, {
                  forceRegenerateSceneIds: newForceList
                } as any);
                console.log(`   ✓ Updated forceRegenerateSceneIds (removed ${generatedSceneIds.length} scenes)`);
              }
            }
          } else {
            console.log(`[${nodeName}]: All scenes skipped (already exist and not forced).`);
          }

          const project = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(project, nodeName);
          return state;

        } catch (error) {
          console.error(`[${nodeName}] error`, { error });
          const currentAttempt = jobs.reduce((max, job) => Math.max(max, job.retryCount || 0), 0);
          interceptNodeInterruptAndThrow(error, nodeName, {
            currentAttempt,
            maxRetries: 3,
            functionName: 'process_scene',
            params: { sceneIds: jobs.map(j => j.payload.sceneId) },
            lastAttemptTimestamp: new Date().toISOString()
          });
        }
      }
      return state;
    });

    workflow.addNode("render_video", async (state: WorkflowState) => {

      const nodeName = "render_video";
      console.log(`\n[${nodeName}]: Rendering Final Video...`);
      try {
        const scenes = await this.projectRepository.getProjectScenes(state.projectId);
        const project = await this.projectRepository.getProject(state.projectId);

        const videoPaths = scenes.map(s => {
          const sceneVideoAssets = s.assets[ 'scene_video' ];
          return sceneVideoAssets?.versions[ sceneVideoAssets.best ].data;
        }).filter((uri): uri is string => !!uri);
        if (videoPaths.length === 0) {
          console.warn(`[${nodeName}]: No videos to render.`);
          return state;
        }

        const [ version ] = await this.assetManager.getNextVersionNumber({ projectId: this.projectId }, 'render_video');
        const result = await this.ensureJob(
          nodeName,
          "RENDER_VIDEO",
          {
            videoPaths,
            audioGcsUri: project.metadata.audioGcsUri,
          },
          version,
        );

        await this.assetManager.createVersionedAssets(
          { projectId: this.projectId },
          'render_video',
          'video',
          [ result!.renderedVideo ],
          { model: videoModelName },
          true
        );

        return state;
      } catch (error) {
        console.error(`[${nodeName}] error`, { error });
        throw error;
      }
    });

    workflow.addNode("finalize", async (state: WorkflowState) => {
      console.log(`\n✅ [finalize]: Finalizing...`);
      const project = await this.projectRepository.updateProject(state.projectId, { status: "complete" });
      const [ attempt ] = await this.assetManager.createVersionedAssets({ projectId: this.projectId }, 'final_output', 'text', [ JSON.stringify(project) ], {
        model: textModelName
      });
      const objectPath = this.storageManager.getObjectPath({ type: "final_output", projectId: project.projectId, attempt: attempt.version });
      await this.storageManager.uploadJSON(
        project,
        objectPath
      );
      console.log(`\n🎉 Video generation complete!`);
      console.log(`   Output saved to: ${this.storageManager.getPublicUrl(objectPath)}`);
      await this.publishStateUpdate(project, "finalize");
      return state;
    });

    workflow.addConditionalEdges(START, async (state: WorkflowState) => {
      const scenes = await this.projectRepository.getProjectScenes(state.projectId);
      const project = await this.projectRepository.getProject(state.projectId);
      if (scenes.some(s => {
        const sceneVideoAssets = s.assets[ 'scene_video' ];
        return sceneVideoAssets?.versions[ sceneVideoAssets.best ].data;
      })) {
        console.log(" Resuming from 'process_scene'");
        return "process_scene";
      }
      if (project.metadata.enhancedPrompt) return "generate_character_assets";
      return "expand_creative_prompt";
    });
    workflow.addConditionalEdges("expand_creative_prompt" as any, (state: WorkflowState) => {
      if (state.hasAudio) {
        return "create_scenes_from_audio";
      }
      return "generate_storyboard_exclusively_from_prompt";
    });
    // Non-audio workflow path
    workflow.addEdge("generate_storyboard_exclusively_from_prompt" as any, "semantic_analysis" as any);
    // Audio-based workflow path
    workflow.addEdge("create_scenes_from_audio" as any, "enrich_storyboard_and_scenes" as any);
    workflow.addEdge("enrich_storyboard_and_scenes" as any, "semantic_analysis" as any);
    workflow.addEdge("semantic_analysis" as any, "generate_character_assets" as any);
    workflow.addEdge("generate_storyboard_exclusively_from_prompt" as any, "generate_character_assets" as any);
    workflow.addEdge("generate_character_assets" as any, "process_scene" as any);
    workflow.addEdge("generate_location_assets" as any, "generate_scene_assets" as any);
    workflow.addEdge("generate_scene_assets" as any, "process_scene" as any);
    workflow.addConditionalEdges("process_scene" as any, async (state: WorkflowState) => {
      const scenes = await this.projectRepository.getProjectScenes(state.projectId);
      const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
      if (executionMode === 'SEQUENTIAL') {
        if (state.currentSceneIndex < (scenes.length || 0)) {
          return "process_scene";
        }
      } else {
        const hasPending = scenes.some(s => s.status === 'pending');
        if (hasPending) return "process_scene";
      }
      return "render_video";
    });
    workflow.addEdge("render_video" as any, "finalize" as any);
    workflow.addEdge("finalize" as any, END);

    return workflow;
  }

  async execute(localAudioPath: string | undefined, title: string, initialPrompt: string, postgresUrl: string): Promise<WorkflowState> {

    console.log(`🚀 Executing Cinematic Video Generation Workflow for projectId: ${this.projectId}`);
    console.log(` Text generation model: ${textModelName}`);
    console.log(` Image generation model: ${imageModelName}`);
    console.log(` Video generation model: ${videoModelName}`);
    console.log(` Quality check model: ${qualityCheckModelName}`);


    let audioGcsUri: string | undefined;
    let audioPublicUri: string | undefined;
    if (localAudioPath) {
      console.log(" Uploading audio file...");
      audioGcsUri = await this.storageManager.uploadAudioFile(localAudioPath);
      audioPublicUri = audioGcsUri ? this.storageManager.getPublicUrl(audioGcsUri) : undefined;
    } else {
      console.log(" No audio file was provided. Videos will be generated in prompt-only mode.");
    }
    const hasAudio = !!audioGcsUri;


    let result: WorkflowState;
    const checkpointerManager = new CheckpointerManager(postgresUrl);
    await checkpointerManager.init();
    const checkpointer = checkpointerManager.getCheckpointer();
    const config: RunnableConfig = {
      configurable: { thread_id: this.projectId },
    };
    console.log("   Checkpointer enabled");
    const existingCheckpoint = await checkpointerManager.loadCheckpoint(config);


    let initialState: WorkflowState;
    if (existingCheckpoint) {
      const stateValues = existingCheckpoint.channel_values as WorkflowState;
      initialState = {
        ...stateValues,
        id: stateValues.id,
        projectId: stateValues.projectId,
        localAudioPath,
        hasAudio,
        jobIds: stateValues.jobIds || [],
        currentSceneIndex: stateValues.currentSceneIndex || 0,
        errors: stateValues.errors || [],
      };

      const project = await this.projectRepository.getProject(this.projectId);
      z.parse(InitialProjectSchema, project);
      console.log("   Checkpoint found previous project.");

    } else {
      console.log(" No existing checkpoint found. Starting new workflow.");
      try {
        initialState = {
          id: this.projectId,
          projectId: this.projectId,
          localAudioPath,
          hasAudio,
          jobIds: {},
          currentSceneIndex: 0,
          errors: [],
        };

        const metadata: InitialProject[ 'metadata' ] = {
          projectId: this.projectId,
          title,
          duration: 0,
          totalScenes: 0,
          style: "",
          mood: "",
          colorPalette: [],
          tags: [],
          audioPublicUri,
          audioGcsUri,
          initialPrompt,
          hasAudio,
          models: {
            videoModel: videoModelName,
            imageModel: imageModelName,
            textModel: textModelName,
            qaModel: qualityCheckModelName,
          },
        };

        await this.projectRepository.createProject({
          id: this.projectId,
          status: "pending",
          metadata: metadata,
          currentSceneIndex: 0,
          forceRegenerateSceneIds: [],
          assets: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          storyboard: {
            metadata: metadata,
            characters: [],
            scenes: [],
            locations: [],
          },
          generationRules: [],
          generationRulesHistory: [],
          projectId: this.projectId,
          });
      } catch (error) {
        console.error(" ! Error creating project in database.", error);
        throw error;
      }
    }

    const compiled = this.graph.compile({ checkpointer });
    result = await compiled.invoke(initialState, {
      configurable: { thread_id: this.projectId },
      recursionLimit: 100,
      signal: this.controller?.signal,
    }) as WorkflowState;

    return result;
  }
}


async function main() {

  // intialize variables
  const gcpProjectId = process.env.GCP_PROJECT_ID!;
  const bucketName = process.env.GCP_BUCKET_NAME!;
  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl) {
    throw new Error("Postgres URL is required for CheckpointerManager initialization");
  }
  const LOCAL_AUDIO_PATH = process.env.LOCAL_AUDIO_PATH;
  const controller = new AbortController();


  process.on("SIGINT", async () => {
    console.log("Shutting down workflow...");
    controller.abort();
    try {
      console.log("Aborted controller. Waiting for cleanup...");
    } catch (e) {
      console.error("Error during abort sequence", e);
    }
    console.log("Exiting...");
    setTimeout(() => {
      process.exit(1);
    }, 5000);
  });


  // initialize services (pubsub, poolManager, etc)
  const pubsub = new PubSub({
    projectId: gcpProjectId,
    apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
  });
  const jobEventsTopicPublisher = pubsub.topic(JOB_EVENTS_TOPIC_NAME);
  console.debug(`Initialized topic ${JOB_EVENTS_TOPIC_NAME}`);

  async function publishJobEvent(event: JobEvent) {
    console.log(`[Cinematic-Canvas] Publishing job event ${event.type} to ${JOB_EVENTS_TOPIC_NAME}`);
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await jobEventsTopicPublisher.publishMessage({ data: dataBuffer });
  }

  const poolManager = new PoolManager({
    connectionString: postgresUrl,
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
  });
  const jobControlPlane = new JobControlPlane(poolManager, publishJobEvent);
  await jobControlPlane.init();


  // parse command line args
  const argv = await yargs(hideBin(process.argv))
    .option("id", {
      alias: [ "resume", "projectId" ],
      type: "string",
      description: "Video ID to resume a project (optional)",
    })
    .option("audio", {
      alias: [ "file", "audioPath" ],
      type: "string",
      description: "Path to local audio file (optional)",
    })
    .option("prompt", {
      alias: "enhancedPrompt",
      type: "string",
      description: "Creative prompt for the video",
      demandOption: true,
    })
    .option("title", {
      alias: "name",
      type: "string",
      description: "Video title (optional)",
    })
    .help()
    .argv;
  const projectTitle = argv.id || "";
  const projectId = argv.id || `video_${Date.now()}`;
  const audioPath = argv.audio || LOCAL_AUDIO_PATH || undefined;
  const prompt = argv.prompt;
  if (!prompt) { throw new Error("A prompt is required to create videos"); }

  const workflow = new CinematicVideoWorkflow({ gcpProjectId, projectId, bucketName, jobControlPlane, controller });
  try {
    const result = await workflow.execute(audioPath, projectTitle, prompt, postgresUrl);
    console.log("\n" + "=".repeat(60));
    console.log("✅ Workflow completed successfully!");

  } catch (error) {
    if (controller.signal.aborted) {
      console.log("\n🛑 Workflow aborted by user.");
      process.exit(0);
    }
    console.error("\n❌ Workflow failed:", error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}