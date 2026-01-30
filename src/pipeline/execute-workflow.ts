import * as dotenv from "dotenv";
dotenv.config();
import { StateGraph, END, START, NodeInterrupt, Command, interrupt, Send } from "@langchain/langgraph";
import { JobControlPlane } from "../shared/services/job-control-plane.js";
import { PoolManager } from "../shared/services/pool-manager.js";
import { DistributedLockManager } from "../shared/services/lock-manager.js";
import { JobEvent, JobRecord, JobType } from "../shared/types/job.types.js";
import {
  AssetKey,
  AssetType,
  AssetVersion,
  LlmRetryInterruptValue,
  Project,
  ProjectMetadata,
  Scene,
  Storyboard,
  WorkflowState,
} from "../shared/types/index.js";
import { PipelineEvent } from "../shared/types/pipeline.types.js";
import { GCPStorageManager } from "../shared/services/storage-manager.js";
import { TextModelController } from "../shared/llm/text-model-controller.js";
import { VideoModelController } from "../shared/llm/video-model-controller.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { imageModelName, qualityCheckModelName, textModelName, videoModelName } from "../shared/llm/google/models.js";
import { CheckpointerManager } from "./checkpointer-manager.js";
import { RunnableConfig } from "@langchain/core/runnables";

import { ProjectRepository } from "../shared/services/project-repository.js";
import { AudioProcessingAgent } from "../shared/agents/audio-processing-agent.js";
import { FrameCompositionAgent } from "../shared/agents/frame-composition-agent.js";
import { ContinuityManagerAgent } from "../shared/agents/continuity-manager.js";
import { PubSub } from "@google-cloud/pubsub";
import { JOB_EVENTS_TOPIC_NAME } from "../shared/constants.js";
import { AssetVersionManager } from "../shared/services/asset-version-manager.js";
import { MediaController } from "../shared/services/media-controller.js";
import { extractGenerationRules } from "../shared/prompts/prompt-composer.js";
import { errorHandler } from "./nodes/error-handler.js";
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BatchJobs, Dispatcher } from "./dispatcher.js";
import { interceptNodeInterruptAndThrow } from "../shared/utils/errors.js";
import { getPool, initializeDatabase } from "../shared/db/index.js";
import { CinematicVideoWorkflow } from "./graph.js";
import { v7 as uuidv7 } from "uuid";



async function execute(graph: CinematicVideoWorkflow[ 'graph' ], controller: any, projectId: string, audioPath: string | undefined, videoTitle: string, creativePrompt: string, postgresUrl: string, lockManager: DistributedLockManager, storageManager: any, projectRepository: any): Promise<WorkflowState> {

  console.log(`\n--- Starting Workflow for Project: ${projectId} ---`);

  const lockAcquired = await lockManager.acquireLock(projectId, {
    lockTTL: 60000, // 1 minute
    heartbeatInterval: 20000, // 20 seconds
  });
  if (!lockAcquired) {
    console.error(`[Cinematic-Canvas]: ❌ Execution Aborted: Project ${projectId} is already locked by another process.`);
    throw new Error(`Project ${projectId} is locked`);
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
      audioGcsUri = await storageManager.uploadAudioFile(audioPath);
      audioPublicUri = audioGcsUri ? storageManager.getPublicUrl(audioGcsUri) : undefined;
    } else {
      console.log(" No audio file was provided. Videos will be generated in prompt-only mode.");
    }
    const hasAudio = !!audioGcsUri;
    const config: RunnableConfig = {
      configurable: { thread_id: projectId },
    };
    console.log("   Checkpointer enabled");
    const existingCheckpoint = await checkpointer.get(config);

    let initialState: WorkflowState;
    if (existingCheckpoint) {
      console.log(" Resuming from existing checkpoint...");
      const stateValues = existingCheckpoint.channel_values as WorkflowState;

      initialState = WorkflowState.parse({
        ...stateValues,
        localAudioPath: audioPath,
        hasAudio,
      });

      console.log("   Checkpoint found previous project.");
    } else {
      console.log(" No existing checkpoint found. Starting new workflow.");
      try {

        initialState = WorkflowState.parse({
          id: projectId,
          projectId: projectId,
          localAudioPath: audioPath,
          hasAudio,
        });

        const metadata = ProjectMetadata.parse({
          projectId: projectId,
          title: videoTitle,
          audioPublicUri,
          audioGcsUri,
          initialPrompt: creativePrompt,
          hasAudio,
        });

        const storyboard = Storyboard.parse({ metadata });

        const newProject = Project.parse({
          id: projectId,
          metadata: metadata,
          storyboard: storyboard,
        });

        await projectRepository.createProject(newProject);
      } catch (error) {
        console.error(" ! Error creating project in database.", error);
        throw error;
      }
    }

    const compiled = graph.compile({ checkpointer });

    if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      const graphData = await compiled.getGraphAsync();

      const mermaidText = graphData.drawMermaid();
      const textPath = path.resolve('./website/contents/docs/graph_structure.mmd');
      await fs.writeFile(textPath, mermaidText);
      console.debug(`[Debug]: Graph definition saved: file://${textPath}`);

      try {
        const pngBlob = await graphData.drawMermaidPng();
        const pngBuffer = Buffer.from(await pngBlob.arrayBuffer());
        const pngPath = path.resolve('./website/contents/docs/graph_diagram.png');
        await fs.writeFile(pngPath, pngBuffer);
        console.debug(`[Debug]: Graph image saved: file://${pngPath}`);
      } catch (e) {
        console.warn("[Debug]: Failed to generate PNG. (Ensure 'canvas' or 'playwright' is available if required by your environment).");
      }
    }


    // INTERRUPTS ARE NOT HANDLED WHEN USING CLI EXECUTION!!
    result = await compiled.invoke(initialState, {
      configurable: { thread_id: projectId },
      recursionLimit: 100,
      signal: controller?.signal,
    }) as WorkflowState;

    return result;
  } finally {
    await lockManager.releaseLock(projectId);
  }
}


async function main() {

  const gcpProjectId = process.env.GCP_PROJECT_ID!;
  const bucketName = process.env.GCP_BUCKET_NAME!;
  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl) {
    throw new Error("Postgres URL is required for CheckpointerManager initialization");
  }

  initializeDatabase(getPool());

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
  let storageManager: GCPStorageManager;
  let projectRepository: ProjectRepository;

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
  const projectId = argv.id || uuidv7();
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
      console.log({ event }, `Workflow publishing job event to ${JOB_EVENTS_TOPIC_NAME}`);
      const dataBuffer = Buffer.from(JSON.stringify(event));
      await jobEventsTopicPublisher.publishMessage({ data: dataBuffer });
    };

    poolManager = new PoolManager();

    projectRepository = new ProjectRepository();

    storageManager = new GCPStorageManager(gcpProjectId, projectId, bucketName);

    lockManager = new DistributedLockManager(poolManager, `workflow-cli-${projectId}`);
    await lockManager.init();
    jobControlPlane = new JobControlPlane(poolManager, publishJobEvent);
  } catch (error) {
    console.error(`[Workflow] FATAL: PubSub initialization failed:`, error);
    console.error(`[Workflow] Service cannot start without PubSub. Shutting down...`);
    process.exit(1);
  }


  const workflow = new CinematicVideoWorkflow({
    gcpProjectId,
    projectId,
    bucketName,
    jobControlPlane,
    storageManager,
    lockManager,
    projectRepository,
    controller
  });
  try {

    const result = await execute(
      workflow[ 'graph' ],
      controller,
      projectId,
      audioPath,
      projectTitle,
      prompt,
      postgresUrl,
      lockManager,
      storageManager,
      projectRepository
    );

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
