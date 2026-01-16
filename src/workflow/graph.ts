// src/workflow/graph.ts
import * as dotenv from "dotenv";
dotenv.config();
import { StateGraph, END, START, NodeInterrupt, Command, interrupt } from "@langchain/langgraph";
import { JobControlPlane } from "../pipeline/services/job-control-plane";
import { PoolManager } from "../pipeline/services/pool-manager";
import { DistributedLockManager } from "../pipeline/services/lock-manager";
import { JobEvent, JobRecord, JobType } from "../shared/types/job.types";
import {
  AssetKey,
  AssetType,
  AssetVersion,
  InitialProject,
  InitialProjectSchema,
  LlmRetryInterruptValue,
  Project,
  Scene,
  WorkflowState,
} from "../shared/types/workflow.types";
import { PipelineEvent } from "../shared/types/pipeline.types";
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
import { MediaController } from "./media-controller";
import { extractGenerationRules } from "./prompts/prompt-composer";
import { errorHandler } from "./nodes/error-handler";



// ============================================================================
// CINEMATIC VIDEO FRAMEWORK - TypeScript Implementation
// Google Vertex AI + LangGraph + GCP Storage
// ============================================================================

type JobPayload<T = JobType> =
  Extract<JobRecord, { type: T; }>[ 'payload' ] extends undefined
  ? [ payload?: undefined ]
  : [ payload: Extract<JobRecord, { type: T; }>[ 'payload' ] ];

type BatchJobs<T extends JobType = JobType> = (
  Pick<Extract<JobRecord, { type: T; }>, "type" | "uniqueKey" | "assetKey">
  & { payload: JobPayload<T>[ 0 ]; }
)[];

export class CinematicVideoWorkflow {
  public graph: StateGraph<WorkflowState>;
  private storageManager: GCPStorageManager;
  private jobControlPlane: JobControlPlane;
  private lockManager: DistributedLockManager;
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
      lockManager,
      controller,
      location = "us-east1",
    }:
      {
        gcpProjectId: string;
        projectId: string;
        bucketName: string;
        jobControlPlane: JobControlPlane;
        lockManager: DistributedLockManager;
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
    this.lockManager = lockManager;
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

  private async publishStateUpdate(project: Project | InitialProject, nodeName: string) {
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
    // payload: Extract<JobRecord, { type: T; }>[ 'payload' ],
    assetKey: AssetKey,
    ...payloadArg: JobPayload<T>
  ): Promise<{ jobId: string; } & Extract<JobRecord, { type: T; }>[ 'result' ] | undefined> {

    const [ payload ] = payloadArg;
    // 1. Fetch the latest job for this project + type + logic scoping
    // We use nodeName as the uniqueKey for singleton jobs to ensure they are addressed correctly.
    const job = await this.jobControlPlane.getLatestJob(this.projectId, jobType, nodeName);

    // use the nodeName/uniqueKey for logical lookup.
    const logicalKey = nodeName;

    const interruptValue: LlmRetryInterruptValue = {
      type: "waiting_for_job",
      error: "waiting_for_job",
      errorDetails: { jobId: job?.id, logicalKey },
      functionName: "ensureJob",
      nodeName,
      projectId: this.projectId,
      attempt: job?.attempt || 1,
      lastAttemptTimestamp: new Date().toISOString(),
    };

    if (!job) {
      // 3. Create initial job if none exists
      // We omit the 'id' to let it generate a random uuidv7 PK.
      // The 'uniqueKey' is our stable address for find/recover.
      await this.jobControlPlane.createJob({
        type: jobType,
        projectId: this.projectId,
        payload,
        uniqueKey: nodeName,
        assetKey: assetKey,
      });
      console.log(`[${nodeName}] Dispatched job for ${nodeName}`);
      interrupt(interruptValue);
    }

    // 4. Handle existing job states
    if (job?.state === 'COMPLETED') {
      const result = job.result as any;
      if (!result) {
          throw new Error(`Job ${job.id} complete but no result was returned.`);
        }
      return { ...result, jobId: job.id };
    }

    if (job?.state === 'FAILED') {
      // 5. Normal Retry: If failed but we have retries left, requeue the SAME record
      if (job.attempt < job.maxRetries) {
        console.log(`[${nodeName}] Job ${job.id} failed (Attempt ${job.attempt}/${job.maxRetries}). Requeueing...`);
        await this.jobControlPlane.requeueJob(job.id, job.attempt, 'BACKOFF_RETRY');
        interrupt(interruptValue);
      }

      // 6. Option 2 "Way Through": If we are here, retries are exhausted.
      throw new Error(`Job ${job.id} failed and exhausted all ${job.maxRetries} retries. To reset, a new job record with the same uniqueKey must be created.`);
    }

    // Still RUNNING, CREATED, or other non-terminal states
    interrupt(interruptValue);
  }

  private async ensureBatchJobs<T extends JobType>(
    nodeName: string,
    jobs: BatchJobs<T>,
  ): Promise<NonNullable<{ jobId: string; } & Extract<JobRecord, { type: T; }>[ 'result' ]>[]> {

    const results: NonNullable<{ jobId: string; } & Extract<JobRecord, { type: T; }>[ 'result' ]>[] = [];
    const missingJobs: typeof jobs = [];
    const failedJobs: { id: string; attempt: number; error: string; }[] = [];
    let runningCount = 0;

    // 1. Check status of all requested jobs using 'getLatestJob' for logical addressing
    for (const jobRequest of jobs) {
      // For batch jobs, we treat the 'id' field as the uniqueKey (the logical address)
      const job = await this.jobControlPlane.getLatestJob(this.projectId, jobRequest.type, jobRequest.uniqueKey);

      if (!job) {
        missingJobs.push(jobRequest);
      } else if (job.state === 'COMPLETED') {
        if (!job.result) throw new Error(`Job ${job.id} has no result object`);
        results.push(job.result as any);
      } else if (job.state === 'FAILED') {
        failedJobs.push({ id: job.id, attempt: job.attempt, error: job.error || "Unknown error" });
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
        errorDetails: { failedJobs },
        functionName: "ensureBatchJobs",
        nodeName: nodeName,
        projectId: this.projectId,
        params: {
          jobIds: failedJobs.map(f => f.id)
        },
        attempt: failedJobs[ 0 ].attempt,
        lastAttemptTimestamp: new Date().toISOString(),
      };

      interrupt(interruptValue);
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
            uniqueKey: jobRequest.uniqueKey, 
          });
          runningCount++;
        }
      }
    }

    // 4. Wait if any are running or if we still have missing jobs (queued)
    const notCompletedCount = jobs.length - results.length;

    if (notCompletedCount > 0) {
      console.log(`[${nodeName}] Waiting for ${notCompletedCount} jobs (${runningCount} running, ${jobs.length - results.length - runningCount} pending start)...`);
      const interruptValue: LlmRetryInterruptValue = {
        type: "waiting_for_batch",
        error: `Waiting for ${notCompletedCount} batch jobs to complete`,
        errorDetails: { pendingJobs: notCompletedCount },
        functionName: "ensureBatchJobs",
        nodeName: nodeName,
        projectId: this.projectId,
        attempt: 1, // TODO Possibly fix this if it adds value for the user
        lastAttemptTimestamp: new Date().toISOString(),
      };
      interrupt(interruptValue);
    }

    return results as any;
  }

  private buildGraph(): StateGraph<WorkflowState> {
    const workflow = new StateGraph<WorkflowState>({
      channels: {
        id: null,
        projectId: null,
        initialProject: null,
        project: null,
        hasAudio: null,
        localAudioPath: null,
        currentSceneIndex: null,
        nodeAttempts: {
          reducer: (x, y) => ({ ...x, ...y }),
          default: () => ({}),
        },
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

    workflow.addConditionalEdges(START, async (state: WorkflowState) => {
      const project = await this.projectRepository.getProject(state.projectId);
      const scenes = await this.projectRepository.getProjectScenes(state.projectId);

      if (scenes.some(s => {
        const sceneVideoAssets = s.assets[ 'scene_video' ];
        const hasVideo = !!sceneVideoAssets?.versions[ sceneVideoAssets.best ]?.data;
        return hasVideo;
      })) {
        console.log(" [Cinematic-Canvas]: Resuming from 'process_scene'");
        return "process_scene";
      }
      if (project.storyboard?.scenes?.length > 0) {
        if (project.generationRules.length > 0) {
          console.log("[Cinematic-Canvas]: Proceeding to 'generate_character_assets'");
          return "generate_character_assets";
        }
        console.log("[Cinematic-Canvas]: Proceeding to 'semantic_analysis'");
        return "semantic_analysis";
      }
      console.log("[Cinematic-Canvas]: Proceeding to 'expand_creative_prompt'");
      return "expand_creative_prompt";
    });

    workflow.addEdge("generate_storyboard_exclusively_from_prompt" as any, "enrich_storyboard_and_scenes" as any); 
    workflow.addEdge("create_scenes_from_audio" as any, "enrich_storyboard_and_scenes" as any);
    workflow.addEdge("enrich_storyboard_and_scenes" as any, "semantic_analysis" as any);
    workflow.addEdge("semantic_analysis" as any, "generate_character_assets" as any);
    workflow.addEdge("generate_character_assets" as any, "generate_location_assets" as any);
    workflow.addEdge("generate_location_assets" as any, "generate_scene_assets" as any);
    workflow.addEdge("generate_scene_assets" as any, "process_scene" as any);
    workflow.addConditionalEdges("process_scene" as any, async (state: WorkflowState) => {
      const scenes = await this.projectRepository.getProjectScenes(state.projectId);
      const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
      if (executionMode === 'SEQUENTIAL') {
        if (state.currentSceneIndex < (scenes.length || 0)) {
          console.log("[process_scene edge]: Looping 'process_scene'");
          return "process_scene";
        }
      } else {
        const hasPending = scenes.some(s => s.status === 'pending');
        if (hasPending) {
          console.log("[process_scene edge]: Pending scenes found, looping 'process_scene'");
          return "process_scene";
        }
      }
      console.log("[process_scene edge]: Proceeding to 'render_video'");
      return "render_video";
    });
    workflow.addEdge("render_video" as any, "finalize" as any);
    workflow.addEdge("finalize" as any, END);

    workflow.addEdge("expand_creative_prompt" as any, "error_handler" as any);
    workflow.addEdge("generate_storyboard_exclusively_from_prompt" as any, "error_handler" as any);
    workflow.addEdge("create_scenes_from_audio" as any, "error_handler" as any);
    workflow.addEdge("enrich_storyboard_and_scenes" as any, "error_handler" as any);
    workflow.addEdge("semantic_analysis" as any, "error_handler" as any);
    workflow.addEdge("generate_character_assets" as any, "error_handler" as any);
    workflow.addEdge("generate_location_assets" as any, "error_handler" as any);
    workflow.addEdge("generate_scene_assets" as any, "error_handler" as any);
    workflow.addEdge("process_scene" as any, "error_handler" as any);
    workflow.addEdge("render_video" as any, "error_handler" as any);

    workflow.addNode("expand_creative_prompt", async (state: WorkflowState) => {
      const nodeName = "expand_creative_prompt";
      console.log(`[${nodeName}]: Started`);
      const project = await this.projectRepository.getProject(state.projectId);
      if (!project.metadata.initialPrompt) throw new Error("No user prompt provided");

      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      try {
        const result = await this.ensureJob(
          nodeName,
          "EXPAND_CREATIVE_PROMPT",
          'enhanced_prompt',
          {
            initialPrompt: project.metadata.initialPrompt,
            title: project.metadata.title,
          },
        );
        const { expandedPrompt } = result!;
        console.log(`   ✓ Expanded to ${expandedPrompt.length} characters of cinematic detail`);

        const updated = await this.projectRepository.updateInitialProject(state.projectId, {
          ...project,
          metadata: { ...project.metadata, enhancedPrompt: expandedPrompt }
        });
        await this.publishStateUpdate(updated, nodeName);
        console.log(`[${nodeName}]: Completed\n`);

        if (state.hasAudio) {
          console.log("[expand_creative_prompt edge]: Proceeding to 'create_scenes_from_audio'");
          return new Command({
            goto: "create_scenes_from_audio",
            update: {
              initialProject: updated,
              __interrupt__: undefined,
              __interrupt_resolved__: false,
            }
          });
        }
        console.log("[expand_creative_prompt edge]: Proceeding to 'generate_storyboard_exclusively_from_prompt'");
        return new Command({
          goto: "generate_storyboard_exclusively_from_prompt",
          update: {
            initialProject: updated,
            __interrupt__: undefined,
            __interrupt_resolved__: false,
          }
        });
      } catch (error: any) {
        if (error instanceof NodeInterrupt) {
          throw error;
        }

        console.error(`[${nodeName}] error`, { error });
        return new Command({
          goto: "error_handler",
          update: {
            nodeAttempts: { [ nodeName ]: currentAttempt },
            errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
          }
        });
      }
    }, {
      ends: [ "create_scenes_from_audio", "generate_storyboard_exclusively_from_prompt", "error_handler" ]
    });

    workflow.addNode("generate_storyboard_exclusively_from_prompt", async (state: WorkflowState) => {
      const nodeName = "generate_storyboard_exclusively_from_prompt";
      console.log(`[${nodeName}]: Started`);
      const project = state.initialProject;
      if (!project?.metadata.enhancedPrompt) throw new Error("No enhanced prompt available");

      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      try {
        const result =  await this.ensureJob(
          nodeName,
          "GENERATE_STORYBOARD",
          "storyboard",
          {
            title: project?.metadata.title,
            enhancedPrompt: project?.metadata.enhancedPrompt
          },
        );
        const { storyboard, jobId } = result!;
        const cleaned = deleteBogusUrlsStoryboard(storyboard);

        await this.projectRepository.createScenes(state.projectId, cleaned.scenes);
        await this.projectRepository.createCharacters(state.projectId, cleaned.characters);
        await this.projectRepository.createLocations(state.projectId, cleaned.locations);
        await this.assetManager.createVersionedAssets(
          { projectId: this.projectId },
          'storyboard',
          'text',
          [ JSON.stringify(storyboard) ],
          { model: textModelName, jobId },
          true
        );
        const updated = await this.projectRepository.updateInitialProject(this.projectId, { storyboard });
        await this.publishStateUpdate(updated, nodeName);
        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          initialProject: updated,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        if (error instanceof NodeInterrupt) {
          throw error;
        }

        console.error(`[${nodeName}] error`, { error });
        return new Command({
          goto: "error_handler",
          update: {
            nodeAttempts: { [ nodeName ]: currentAttempt },
            errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
          }
        });
      }
    }, {
      ends: [ "enrich_storyboard_and_scenes", "error_handler" ]
    });

    workflow.addNode("create_scenes_from_audio", async (state: WorkflowState) => {
      const nodeName = "create_scenes_from_audio";
      console.log(`[${nodeName}]: Started`);
      const project = state.initialProject;
      if (!project?.metadata.enhancedPrompt) throw new Error("No enhanced prompt available");
      if (!project?.metadata.audioPublicUri) throw new Error("No audio public url available");

      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(" Creating Timed Scenes from Audio...");
      try {
        const result = await this.ensureJob(
          nodeName,
          "PROCESS_AUDIO_TO_SCENES",
          "audio_analysis",
          {
            audioPublicUri: project?.metadata.audioPublicUri,
            enhancedPrompt: project?.metadata.enhancedPrompt,
          },
        );
        const { analysis: { segments, ...analysis }, jobId } = result!;
        const metadata = {
          ...project.metadata,
          ...analysis,
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
        await this.assetManager.createVersionedAssets(
          { projectId: this.projectId },
          'storyboard',
          'text',
          [ JSON.stringify(updated.storyboard) ],
          { model: textModelName, jobId }
        );
        await this.publishStateUpdate(updated, nodeName);
        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          initialProject: updated,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        if (error instanceof NodeInterrupt) {
          throw error;
        }

        console.error(`[${nodeName}] error`, { error });
        return new Command({
          goto: "error_handler",
          update: {
            nodeAttempts: { [ nodeName ]: currentAttempt },
            errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
          }
        });
      }
    }, {
      ends: [ "enrich_storyboard_and_scenes", "error_handler" ]
    });

    workflow.addNode("enrich_storyboard_and_scenes", async (state: WorkflowState) => {  
      const nodeName = "enrich_storyboard_and_scenes";
      console.log(`[${nodeName}]: Started`);
      const project = state.initialProject;
      if (!project?.storyboard || !project.storyboard.scenes) throw new Error("No scenes available.");
      if (!project?.metadata.enhancedPrompt) throw new Error("No enhanced prompt available.");

      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(" Enhancing storyboard...");
      try {
        const result = await this.ensureJob(
          nodeName,
          "ENHANCE_STORYBOARD",
          "storyboard",
          {
            storyboard: project.storyboard as any,
            enhancedPrompt: project.metadata.enhancedPrompt
          },
        );
        const { storyboard: rawStoryboard, jobId } = result!;

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
        await this.assetManager.createVersionedAssets(
          { projectId: this.projectId },
          'storyboard',
          'text',
          [ JSON.stringify(storyboard) ],
          { model: textModelName, jobId: jobId }
        );
        await this.publishStateUpdate(updated, nodeName);
        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          initialProject: updated,
          project: updated, // full project is set
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        if (error instanceof NodeInterrupt) {
          throw error;
        }

        console.error(`[${nodeName}] error`, { error });
        return new Command({
          goto: "error_handler",
          update: {
            nodeAttempts: { [ nodeName ]: currentAttempt },
            errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
          }
        });
      }
    }, {
      ends: [ "semantic_analysis", "error_handler" ]
    });

    workflow.addNode("semantic_analysis", async (state: WorkflowState) => {
      const nodeName = "semantic_analysis";
      console.log(`[${nodeName}]: Started`);
      const project = state.project;
      if (!project?.storyboard) throw new Error("No storyboard available.");

      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(" Semantic Rule Analysis...");
      try {
        const result = await this.ensureJob(
          nodeName,
          "SEMANTIC_ANALYSIS",
          "generation_rules",
        );
        const { dynamicRules, jobId } = result!;
        const proactiveRules = (await import("./prompts/generation-rules-presets")).getProactiveRules();
        const uniqueRules = Array.from(new Set([ ...proactiveRules, ...dynamicRules ]));
        console.log(` Rules Initialized: ${proactiveRules.length} Global, ${dynamicRules.length} Semantic.`);

        const updated = await this.projectRepository.updateProject(this.projectId, {
          ...project,
          generationRules: uniqueRules,
          generationRulesHistory: [ ...project.generationRulesHistory, uniqueRules ]
        });
        await this.publishStateUpdate(updated, nodeName);
        await this.assetManager.createVersionedAssets(
          { projectId: this.projectId },
          'generation_rules',
          'text',
          [ JSON.stringify(uniqueRules) ],
          { model: textModelName, jobId: jobId }
        );
        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          initialProject: updated,
          project: updated,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        if (error instanceof NodeInterrupt) {
          throw error;
        }

        console.error(`[${nodeName}] error`, { error });
        return new Command({
          goto: "error_handler",
          update: {
            nodeAttempts: { [ nodeName ]: currentAttempt },
            errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
          }
        });
      }
    }, {
      ends: [ "generate_character_assets", "error_handler" ]
    });

    workflow.addNode("generate_character_assets", async (state: WorkflowState) => {
      const nodeName = "generate_character_assets";
      console.log(`[${nodeName}]: Started`);
      let project = state.project;
      if (!project?.storyboard) throw new Error("No project storyboard available");

      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(` Generating Character References...Attempt ${currentAttempt}`);
      try {
        const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
        console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);

        const characters = project.storyboard.characters;

        let updatedProject: Project;
        if (executionMode === 'SEQUENTIAL') {
          const result = await this.ensureJob(
            nodeName,
            "GENERATE_CHARACTER_ASSETS",
            "character_image",
            {
              characters: characters,
              generationRules: project.generationRules,
            },
          );
          const { characters: updatedChars, jobId } = result!;

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
              { model: imageModelName, jobId }
            );
          }
          updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(updatedProject, nodeName);

        } else {
          // Parallel logic (fan-out)
          const characterIds = characters.map(c => c.id);

          const jobs: BatchJobs<'GENERATE_CHARACTER_ASSETS'> = characters.map((char, index) => ({
            uniqueKey: char.id,
            type: "GENERATE_CHARACTER_ASSETS",
            assetKey: "character_image",
            payload: {
              characters: [ char ],
              generationRules: project.generationRules,
            },
          }));

          const results = await this.ensureBatchJobs(nodeName, jobs);
          const allUpdatedChars = results.flatMap(r => r.characters);
          const updated = await this.projectRepository.updateCharacters(allUpdatedChars);

          const charMap = new Map(updated.map(c => [ c.id, c ]));

          const validIds: string[] = [];
          const validUris: string[] = [];
          const validMetadata: AssetVersion[ 'metadata' ][] = [];
          const validTypes: AssetType[] = [];

          characters.forEach(c => {
            const updatedChar = charMap.get(c.id);
            const assets = getAllBestFromAssets(updatedChar?.assets);
            const imageData = assets[ 'character_image' ]?.data;

            if (updatedChar && imageData) {
              validIds.push(updatedChar.id);
              validUris.push(imageData);
              validTypes.push('image');
              validMetadata.push({
                model: imageModelName,
                jobId: results.find(r => r.characters.some(rc => rc.id === c.id))?.jobId!,
              });
            }
          });
          if (validIds.length > 0) {
            await this.assetManager.createVersionedAssets(
              { projectId: this.projectId, characterIds: validIds },
              'character_image',
              validTypes,
              validUris,
              validMetadata,
              true
            );
          }
          updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(updatedProject, nodeName);
        }

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          project: updatedProject,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        if (error instanceof NodeInterrupt) {
          throw error;
        }

        console.error(`[${nodeName}] error`, { error });
        return new Command({
          goto: "error_handler",
          update: {
            nodeAttempts: { [ nodeName ]: currentAttempt },
            errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
          }
        });
      }
    }, {
      ends: [ "generate_location_assets", "error_handler" ]
    });

    workflow.addNode("generate_location_assets", async (state: WorkflowState) => {
      const nodeName = "generate_location_assets";
      console.log(`[${nodeName}]: Started`);
      let project = state.project;
      if (!project?.storyboard) throw new Error("No project storyboard available");

      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(` Generating Location References...Attempt ${currentAttempt}`);
      let updatedProject: Project;
      try {
        const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
        console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);
        const locations = project.storyboard.locations;
        const locationIds = locations.map(loc => loc.id);

        if (executionMode === 'SEQUENTIAL') {
          const result = await this.ensureJob(
            nodeName,
            "GENERATE_LOCATION_ASSETS",
            "location_image",
            {
              locations: locations,
              generationRules: project.generationRules,
            },
          );
          const { locations: updatedLocs, jobId } = result!;

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
              { model: imageModelName, jobId }
            );
          }
          updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(updatedProject, nodeName);
        } else {

          const jobs: BatchJobs<"GENERATE_LOCATION_ASSETS"> = locations.map((loc, index) => ({
            id: this.jobControlPlane.jobId(this.projectId, nodeName, `loc-${loc.id}`),
            type: "GENERATE_LOCATION_ASSETS" as const,
            assetKey: "location_image",
            payload: {
              locations: [ loc ],
              generationRules: project.generationRules
            },
          }));

          const results = await this.ensureBatchJobs(nodeName, jobs);
          const allUpdatedLocs = results.flatMap(r => r.locations);
          const updated = await this.projectRepository.updateLocations(allUpdatedLocs);

          const locMap = new Map(updated.map(l => [ l.id, l ]));

          const validIds: string[] = [];
          const validUris: string[] = [];
          const validMetadata: AssetVersion[ 'metadata' ][] = [];
          const validTypes: AssetType[] = [];

          locations.forEach(l => {
            const updatedLoc = locMap.get(l.id);
            const assets = getAllBestFromAssets(updatedLoc?.assets);
            const imageData = assets[ 'location_image' ]?.data;

            if (updatedLoc && imageData) {
              validIds.push(updatedLoc.id);
              validUris.push(imageData);
              validTypes.push('image');
              validMetadata.push({
                model: imageModelName,
                jobId: results.find(r => r.locations.some(rl => rl.id === l.id))?.jobId!,
              });
            }
          });
          if (validIds.length > 0) {
            await this.assetManager.createVersionedAssets(
              { projectId: this.projectId, locationIds: validIds },
              'location_image',
              validTypes,
              validUris,
              validMetadata,
              true
            );
          }
          updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(updatedProject, nodeName);
        }
        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          project: updatedProject,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        if (error instanceof NodeInterrupt) {
          throw error;
        }

        console.error(`[${nodeName}] error`, { error });
        return new Command({
          goto: "error_handler",
          update: {
            nodeAttempts: { [ nodeName ]: currentAttempt },
            errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
          }
        });
      }
    }, {
      ends: [ "generate_scene_assets", "error_handler" ]
    });

    workflow.addNode("generate_scene_assets", async (state: WorkflowState) => {
      const nodeName = "generate_scene_assets";
      console.log(`[${nodeName}]: Started`);
      let project = state.project;
      if (!project?.storyboard) throw new Error("No project storyboard available");

      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(` Generating Scene Reference Images...Attempt ${currentAttempt}`);
      try {
        const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
        console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);
        const scenes = await this.projectRepository.getProjectScenes(state.projectId);

        if (executionMode === 'SEQUENTIAL') {
          for (const scene of scenes) {
            const result = await this.ensureJob(
              nodeName,
              "GENERATE_SCENE_FRAMES",
              "scene_start_frame",
              {
                sceneId: scene.id,
                sceneIndex: scene.sceneIndex,
              },
            );

            if (result!.updatedScenes && result!.updatedScenes.length > 0) {
              await this.projectRepository.updateScenes(result!.updatedScenes);
            }
          }

          for (const scene of scenes) {
            const result = await this.ensureJob(
              nodeName,
              "GENERATE_SCENE_FRAMES",
              "scene_end_frame",
              {
                sceneId: scene.id,
                sceneIndex: scene.sceneIndex,
              },
            );

            if (result!.updatedScenes && result!.updatedScenes.length > 0) {
              await this.projectRepository.updateScenes(result!.updatedScenes);
            }
          }
        } else {

          const jobs = await Promise.all(scenes.flatMap((scene) => {
            const assetKeys = [ "scene_start_frame", "scene_end_frame" ] as const;
            return assetKeys.map(async (key) => {
              return {
                id: this.jobControlPlane.jobId(this.projectId, nodeName, `scene-${scene.id}-${key}`),
                type: "GENERATE_SCENE_FRAMES" as const,
                assetKey: key,
                payload: {
                  sceneId: scene.id,
                  sceneIndex: scene.sceneIndex,
                },
              };
            });
          }));

          const results = await this.ensureBatchJobs<"GENERATE_SCENE_FRAMES">(nodeName, jobs);
          const allUpdatedScenes = results.flatMap(r => r.updatedScenes);
          await this.projectRepository.updateScenes(allUpdatedScenes);
        }

        let updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
        await this.publishStateUpdate(updatedProject, nodeName);
        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          project: updatedProject,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        if (error instanceof NodeInterrupt) {
          throw error;
        }

        console.error(`[${nodeName}] error`, { error });
        return new Command({
          goto: "error_handler",
          update: {
            nodeAttempts: { [ nodeName ]: currentAttempt },
            errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
          }
        });
      }
    }, {
      ends: [ "process_scene", "error_handler" ]
    });

    workflow.addNode("process_scene", async (state: WorkflowState) => {

      const nodeName = "process_scene";
      const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(`[${nodeName}]: Processing Scene ${state.currentSceneIndex}. Executing in ${executionMode.toLowerCase()} mode. Attempt ${currentAttempt}`);
      let project = state.project;
      if (!project) throw new Error("No project state available");
      const { scenes } = project;

      let updatedProject: Project;
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
            if (renderedVideo) { await this.assetManager.createVersionedAssets({ projectId: this.projectId }, 'render_video', 'video', [ renderedVideo ], { model: videoModelName, jobId: "" }); }
          }

          project.forceRegenerateSceneIds = project.forceRegenerateSceneIds.slice(0, forceRegenerateIndex).concat(project.forceRegenerateSceneIds.slice(forceRegenerateIndex + 1));
          updatedProject = await this.projectRepository.updateProject(this.projectId, project);
          await this.publishStateUpdate(updatedProject, "process_scene");

          console.log(`[${nodeName}]: Completed (Skipped)\n`);
          return {
            ...state,
            project: updatedProject,
            __interrupt__: undefined,
            __interrupt_resolved__: false,
          };
        }

        console.log(`[${nodeName}]: Processing scene ${scene.sceneIndex} (${index + 1}/${scenes.length}).`);
        const [ next ] = await this.assetManager.getNextVersionNumber({ projectId: this.projectId, sceneId: scene.id }, 'scene_video');
        const result = await this.ensureJob(
          nodeName,
          "GENERATE_SCENE_VIDEO",
          "scene_video",
          {
            sceneId: scene.id,
            sceneIndex: scene.sceneIndex,
            version: next,
          },
        );
        const { scene: generatedScene, acceptedAttempt, evaluation, jobId } = result!;

        // pretty sure these assets get creted on worker side...
        await this.assetManager.createVersionedAssets(
          { projectId: this.projectId, sceneId: scene.id },
          'scene_video',
          'video',
          [ generatedScene.assets[ 'scene_video' ]?.versions[ acceptedAttempt ].data! ],
          { model: videoModelName, evaluation, jobId },
          true
        );

        await this.projectRepository.updateScenes([ generatedScene ]);
        project = this.continuityAgent.updateNarrativeState(generatedScene, project);
        if (evaluation) { project.generationRules = Array.from(new Set(...project.generationRules, ...extractGenerationRules([ evaluation ]))); }
        project.forceRegenerateSceneIds = project.forceRegenerateSceneIds.slice(0, forceRegenerateIndex).concat(project.forceRegenerateSceneIds.slice(forceRegenerateIndex + 1));
        updatedProject = await this.projectRepository.updateProject(this.projectId, project);
        await this.publishStateUpdate(updatedProject, nodeName);

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          project: updatedProject,
          currentSceneIndex: index + 1,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } else {

        // Parallel logic (fan-out)
        const jobs: any[] = [];

        await Promise.all(scenes.map(async (scene) => {
          const forceRegenerateIndex = project?.forceRegenerateSceneIds.findIndex(id => id === scene.id);
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
              id: this.jobControlPlane.jobId(this.projectId, nodeName, `scene-video-${scene.id}`),
              type: "GENERATE_SCENE_VIDEO" as const,
              payload: {
                sceneIndex: scene.sceneIndex,
                sceneId: scene.id,
                version: nextVersion,
              },
            });
          }
        }));

        try {
          if (jobs.length > 0) {
            const results = await this.ensureBatchJobs<"GENERATE_SCENE_VIDEO">(
              nodeName,
              jobs,
            );

            const generatedSceneIds: string[] = [];
            for (const res of results) {
              const { scene: generatedScene, evaluation, acceptedAttempt, jobId } = res;
              await this.assetManager.createVersionedAssets(
                { projectId: this.projectId, sceneId: generatedScene.id },
                'scene_video',
                'video',
                [ generatedScene.assets[ 'scene_video' ]?.versions[ acceptedAttempt ].data! ],
                {
                  model: videoModelName,
                  evaluation,
                  jobId,
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
                updatedProject = await this.projectRepository.updateProject(this.projectId, {
                  forceRegenerateSceneIds: newForceList
                });
                console.log(`   ✓ Updated forceRegenerateSceneIds (removed ${generatedSceneIds.length} scenes)`);
              }
            }
          } else {
            console.log(`[${nodeName}]: All scenes skipped (already exist and not forced).`);
          }

          updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          await this.publishStateUpdate(project, nodeName);
          console.log(`[${nodeName}]: Completed\n`);
          return {
            ...state,
            project: updatedProject,
            __interrupt__: undefined,
            __interrupt_resolved__: false,
          };
        } catch (error: any) {
          if (error instanceof NodeInterrupt) {
            throw error;
          }

          console.error(`[${nodeName}] error`, { error });
          const currentAttempt = jobs.reduce((max, job) => Math.max(max, job.attempt || 0), 0);
          return new Command({
            goto: "error_handler",
            update: {
              nodeAttempts: { [ nodeName ]: currentAttempt },
              errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
            }
          });
        }
      }
    }, {
      ends: [ "process_scene", "render_video", "error_handler" ]
    });

    workflow.addNode("render_video", async (state: WorkflowState) => {

      const nodeName = "render_video";
      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(`\n[${nodeName}]: Rendering Final Video...Attempt ${currentAttempt}`);
      try {
        const project = state.project;
        if (!project) {
          throw new Error("Project not found");
        }

        const scenes = project.scenes;
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
          "render_video",
          {
            videoPaths,
            audioGcsUri: project.metadata.audioGcsUri,
          },
        );

        await this.assetManager.createVersionedAssets(
          { projectId: this.projectId },
          'render_video',
          'video',
          [ result!.renderedVideo ],
          { model: videoModelName, jobId: result!.jobId },
          true
        );

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        if (error instanceof NodeInterrupt) {
          throw error;
        }

        console.error(`[${nodeName}] error`, { error });
        return new Command({
          goto: "error_handler",
          update: {
            nodeAttempts: { [ nodeName ]: currentAttempt },
            errors: [ { node: nodeName, message: error?.message, value: error?.value, shouldRetry: true, timestamp: new Date().toISOString() } ]
          }
        });
      }
    }, {
      ends: [ "finalize", "error_handler" ]
    });

    workflow.addNode("finalize", async (state: WorkflowState) => {
      const nodeName = "finalize";
      console.log(`[${nodeName}]: Started`);
      console.log(`\n✅ [finalize]: Finalizing...`);
      const currentAttempt = (state.nodeAttempts?.[ "finalize" ] || 0) + 1;
      const project = await this.projectRepository.updateProject(state.projectId, { status: "complete" });
      const [ attempt ] = await this.assetManager.createVersionedAssets({ projectId: this.projectId }, 'final_output', 'text', [ JSON.stringify(project) ], {
        model: textModelName,
        jobId: ""
      });
      const objectPath = this.storageManager.getObjectPath({ type: "final_output", projectId: project.id, attempt: attempt.version });
      await this.storageManager.uploadJSON(
        project,
        objectPath
      );
      console.log(`\n🎉 Video generation complete!`);
      console.log(`   Output saved to: ${this.storageManager.getPublicUrl(objectPath)}`);
      await this.publishStateUpdate(project, "finalize");
      console.log(`[${nodeName}]: Completed\n`);
      return {
        ...state,
        project,
        __interrupt__: undefined,
        __interrupt_resolved__: false,
      };
    });

    workflow.addNode("error_handler", errorHandler, {
      ends: [
        "expand_creative_prompt",
        "generate_storyboard_exclusively_from_prompt",
        "create_scenes_from_audio",
        "enrich_storyboard_and_scenes",
        "semantic_analysis",
        "generate_character_assets",
        "generate_location_assets",
        "generate_scene_assets",
        "process_scene",
        "render_video",
        "finalize"
      ]
    });

    return workflow;
  }

  async execute(audioPath: string | undefined, videoTitle: string, creativePrompt: string, postgresUrl: string): Promise<WorkflowState> {
    
    console.log(`\n--- Starting Workflow for Project: ${this.projectId} ---`);

    const lockAcquired = await this.lockManager.acquireLock(this.projectId, {
      lockTTL: 60000, // 1 minute
      heartbeatInterval: 20000, // 20 seconds
    });
    if (!lockAcquired) {
      console.error(`[Cinematic-Canvas]: ❌ Execution Aborted: Project ${this.projectId} is already locked by another process.`);
      throw new Error(`Project ${this.projectId} is locked`);
    }

    let result: WorkflowState;
    try {
      const checkpointerManager = new CheckpointerManager(postgresUrl);
      const checkpointer = checkpointerManager.getCheckpointer();
      console.log(` Image generation model: ${imageModelName}`);
      console.log(` Video generation model: ${videoModelName}`);
      console.log(` Quality check model: ${qualityCheckModelName}`);

      let audioGcsUri: string | undefined;
      let audioPublicUri: string | undefined;

      if (audioPath) {
        console.log(" Uploading audio file...");
        audioGcsUri = await this.storageManager.uploadAudioFile(audioPath);
        audioPublicUri = audioGcsUri ? this.storageManager.getPublicUrl(audioGcsUri) : undefined;
      } else {
        console.log(" No audio file was provided. Videos will be generated in prompt-only mode.");
      }
      const hasAudio = !!audioGcsUri;
      const config: RunnableConfig = {
        configurable: { thread_id: this.projectId },
      };
      console.log("   Checkpointer enabled");
      const existingCheckpoint = await checkpointer.get(config);

      let initialState: WorkflowState;
      if (existingCheckpoint) {
        console.log(" Resuming from existing checkpoint...");
        const stateValues = existingCheckpoint.channel_values as WorkflowState;
        const project = await this.projectRepository.getProjectFullState(this.projectId);

        initialState = {
          ...stateValues,
          id: stateValues.id,
          projectId: stateValues.projectId,
          initialProject: project as any,
          project: project as any,
          localAudioPath: audioPath,
        hasAudio,
        nodeAttempts: stateValues.nodeAttempts || {},
        jobIds: stateValues.jobIds || {},
        currentSceneIndex: stateValues.currentSceneIndex || 0,
        errors: stateValues.errors || [],
      };

      console.log("   Checkpoint found previous project.");

    } else {
      console.log(" No existing checkpoint found. Starting new workflow.");
      try {
        initialState = {
          id: this.projectId,
          projectId: this.projectId,
          initialProject: null,
          project: null,
          localAudioPath: audioPath,
          hasAudio,
          nodeAttempts: {},
          jobIds: {},
          currentSceneIndex: 0,
          errors: [],
        };

        const metadata: InitialProject[ 'metadata' ] = {
          projectId: this.projectId,
          title: videoTitle,
          duration: 0,
          totalScenes: 0,
          style: "",
          mood: "",
          colorPalette: [],
          tags: [],
          audioPublicUri,
          audioGcsUri,
          initialPrompt: creativePrompt,
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
        });
      } catch (error) {
        console.error(" ! Error creating project in database.", error);
        throw error;
      }
    }

    const compiled = this.graph.compile({ checkpointer });
    // INTERRUPTS ARE NOT HANDLED WHEN USING CLI EXECUTION!!
    result = await compiled.invoke(initialState, {
      configurable: { thread_id: this.projectId },
      recursionLimit: 100,
      signal: this.controller?.signal,
    }) as WorkflowState;

    return result;
    } finally {
      await this.lockManager.releaseLock(this.projectId);
    }
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

  let pubsub: PubSub;
  let jobEventsTopicPublisher: ReturnType<PubSub[ 'topic' ]>;
  let poolManager: PoolManager;
  let jobControlPlane: JobControlPlane;
  let lockManager: DistributedLockManager;

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


  try {
    pubsub = new PubSub({
      projectId: gcpProjectId,
      apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
    });
    jobEventsTopicPublisher = pubsub.topic(JOB_EVENTS_TOPIC_NAME);
    console.debug(`Initialized topic ${JOB_EVENTS_TOPIC_NAME}`);

    const publishJobEvent = async (event: JobEvent) => {
      console.log(`[Cinematic-Canvas] Publishing job event ${event.type} to ${JOB_EVENTS_TOPIC_NAME}`);
      const dataBuffer = Buffer.from(JSON.stringify(event));
      await jobEventsTopicPublisher.publishMessage({ data: dataBuffer });
    };

    poolManager = new PoolManager({
      connectionString: postgresUrl,
      max: 10,
      min: 2,
      idleTimeoutMillis: 30000,
    });
    lockManager = new DistributedLockManager(poolManager, `workflow-cli-${projectId}`);
    await lockManager.init();
    jobControlPlane = new JobControlPlane(poolManager, publishJobEvent);
  } catch (error) {
    console.error(`[Workflow] FATAL: PubSub initialization failed:`, error);
    console.error(`[Workflow] Service cannot start without PubSub. Shutting down...`);
    process.exit(1);
  }


  const workflow = new CinematicVideoWorkflow({ gcpProjectId, projectId, bucketName, jobControlPlane, lockManager, controller });
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
