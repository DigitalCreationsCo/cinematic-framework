import * as dotenv from "dotenv";
dotenv.config();
import { StateGraph, END, START, NodeInterrupt, Command, interrupt, Send } from "@langchain/langgraph";
import { JobControlPlane } from "../shared/services/job-control-plane.js";
import { DistributedLockManager } from "../shared/services/lock-manager.js";
import {
  Project,
  ProjectMetadata,
  Storyboard,
  WorkflowState,
} from "../shared/types/index.js";
import { PipelineEvent } from "../shared/types/pipeline.types.js";
import { GCPStorageManager } from "../shared/services/storage-manager.js";
import { imageModelName, qualityCheckModelName, textModelName, videoModelName } from "../shared/llm/google/models.js";
import { CheckpointerManager } from "./checkpointer-manager.js";
import { RunnableConfig } from "@langchain/core/runnables";
import { ProjectRepository } from "../shared/services/project-repository.js";
import { AssetVersionManager } from "../shared/services/asset-version-manager.js";
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Dispatcher } from "../pipeline/dispatcher.js";
import { interceptNodeInterruptAndThrow } from "../shared/utils/errors.js";



// ============================================================================
// CINEMATIC VIDEO FRAMEWORK - TypeScript Implementation
// Google Vertex AI + LangGraph + GCP Storage
// ============================================================================

export class CinematicVideoWorkflow {
  public graph: StateGraph<WorkflowState>;
  private storageManager: GCPStorageManager;
  private jobControlPlane: JobControlPlane;
  private lockManager: DistributedLockManager;
  private projectRepository: ProjectRepository;
  private assetManager: AssetVersionManager;
  private dispatcher: Dispatcher;

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
      storageManager,
      projectRepository,
      jobControlPlane,
      lockManager,
      controller,
      location = "us-east1",
    }:
      {
        gcpProjectId: string;
        projectId: string;
        bucketName: string;
        storageManager?: GCPStorageManager;
        projectRepository?: ProjectRepository;
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
    this.MAX_PARALLEL_JOBS = Number(process.env.MAX_PARALLEL_JOBS) || 2;
    this.MAX_RETRIES = Number(process.env.MAX_RETRIES) || 2;

    this.storageManager = storageManager || new GCPStorageManager(this.gcpProjectId, this.projectId, this.bucketName);
    this.projectRepository = projectRepository || new ProjectRepository();
    this.jobControlPlane = jobControlPlane;
    this.lockManager = lockManager;
    this.assetManager = new AssetVersionManager(this.projectRepository);
    this.dispatcher = new Dispatcher(this.projectId, this.MAX_PARALLEL_JOBS, this.jobControlPlane);

    // this.audioProcessingAgent = new AudioProcessingAgent(
    //   textandImageModel,
    //   this.storageManager,
    //   new MediaController(this.storageManager),
    //   agentOptions
    // );

    this.graph = this.buildGraph();
  }

  public publishEvent: (event: PipelineEvent) => Promise<void> = async () => { };

  private async publishStateUpdate(project: Project, nodeName: string) {
    this.publishEvent({
      type: "FULL_STATE",
      projectId: this.projectId,
      payload: { project },
      timestamp: new Date().toISOString(),
    });
    console.log(`✓ Updated project after ${nodeName}`);
  }

  private buildGraph(): StateGraph<WorkflowState> {
    const workflow = new StateGraph<WorkflowState>({
      channels: {
        id: null,
        projectId: null,
        localAudioPath: null,
        hasAudio: null,
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

      if (project.metadata.enhancedPrompt) {
        console.log("[Cinematic-Canvas]: Proceeding to 'enrich_storyboard_and_scenes'");
        return "enrich_storyboard_and_scenes";
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
          console.log({ projectId: state.projectId, currentSceneIndex: state.currentSceneIndex, scenesLength: scenes.length }, "'process_scene': Continuing sequential loop");
          return "process_scene";
        }
      } else {
        const hasPending = scenes.some(s => s.status === 'pending');
        if (hasPending) {
          console.log({ projectId: state.projectId, currentSceneIndex: state.currentSceneIndex, scenesLength: scenes.length }, "'process_scene': Running in parallel mode");
          return "process_scene";
        }
      }
      console.log({ projectId: state.projectId, currentSceneIndex: state.currentSceneIndex, scenesLength: scenes.length }, "'process_scene': Proceeding to 'render_video'");
      return "render_video";
    });
    workflow.addEdge("render_video" as any, "finalize" as any);
    workflow.addEdge("finalize" as any, END);

    // workflow.addEdge("expand_creative_prompt" as any, "error_handler" as any);
    // workflow.addEdge("generate_storyboard_exclusively_from_prompt" as any, "error_handler" as any);
    // workflow.addEdge("create_scenes_from_audio" as any, "error_handler" as any);
    // workflow.addEdge("enrich_storyboard_and_scenes" as any, "error_handler" as any);
    // workflow.addEdge("semantic_analysis" as any, "error_handler" as any);
    // workflow.addEdge("generate_character_assets" as any, "error_handler" as any);
    // workflow.addEdge("generate_location_assets" as any, "error_handler" as any);
    // workflow.addEdge("generate_scene_assets" as any, "error_handler" as any);
    // workflow.addEdge("process_scene" as any, "error_handler" as any);
    // workflow.addEdge("render_video" as any, "error_handler" as any);

    workflow.addNode("expand_creative_prompt", async (state: WorkflowState) => {
      const nodeName = "expand_creative_prompt";
      console.log(`[${nodeName}]: Started`);
      try {

        await this.dispatcher.ensureJob(
          nodeName,
          "EXPAND_CREATIVE_PROMPT",
          'enhanced_prompt',
        );

        console.log(`[${this.projectId}-${nodeName}]: Completed\n`);

        return new Command({
          goto: state.hasAudio ? "create_scenes_from_audio" : "generate_storyboard_exclusively_from_prompt",
          update: {
            __interrupt__: undefined,
            __interrupt_resolved__: false,
          }
        });

      } catch (error: any) {
        const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
        interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
      }
    }, {
      ends: [ "create_scenes_from_audio", "generate_storyboard_exclusively_from_prompt", ]
    });

    workflow.addNode("generate_storyboard_exclusively_from_prompt", async (state: WorkflowState) => {
      const nodeName = "generate_storyboard_exclusively_from_prompt";
      console.log(`[${nodeName}]: Started`);

      try {
        await this.dispatcher.ensureJob(
          nodeName,
          "GENERATE_STORYBOARD",
          "storyboard"
        );

        console.log(`[${nodeName}]: Completed\n`);

        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
        interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
      }
    }, {
      ends: [ "enrich_storyboard_and_scenes", ]
    });

    workflow.addNode("create_scenes_from_audio", async (state: WorkflowState) => {
      const nodeName = "create_scenes_from_audio";
      console.log(`[${nodeName}]: Started`);

      console.log(" Creating Timed Scenes from Audio...");
      try {
        await this.dispatcher.ensureJob(
          nodeName,
          "PROCESS_AUDIO_TO_SCENES",
          "audio_analysis"
        );

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
        interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
      }
    }, {
      ends: [ "enrich_storyboard_and_scenes", ]
    });

    workflow.addNode("enrich_storyboard_and_scenes", async (state: WorkflowState) => {
      const nodeName = "enrich_storyboard_and_scenes";
      console.log(`[${nodeName}]: Started`);

      console.log(" Enhancing storyboard...");
      try {

        await this.dispatcher.ensureJob(
          nodeName,
          "ENHANCE_STORYBOARD",
          "storyboard",
        );

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
        interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
      }
    }, {
      ends: [ "semantic_analysis", ]
    });

    workflow.addNode("semantic_analysis", async (state: WorkflowState) => {
      const nodeName = "semantic_analysis";
      console.log(`[${nodeName}]: Started`);

      try {
        await this.dispatcher.ensureJob(
          nodeName,
          "SEMANTIC_ANALYSIS",
          "generation_rules",
        );

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
        interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
      }
    }, {
      ends: [ "generate_character_assets", ]
    });

    workflow.addNode("generate_character_assets", async (state: WorkflowState) => {
      const nodeName = "generate_character_assets";
      console.log(`[${nodeName}]: Started`);

      console.log(` Generating Character References `);
      try {
        const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
        console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);

        if (executionMode === 'SEQUENTIAL') {
          await this.dispatcher.ensureJob(
            nodeName,
            "GENERATE_CHARACTER_ASSETS",
            "character_image"
          );

        } else {

          await this.dispatcher.ensureJob(
            nodeName,
            "GENERATE_CHARACTER_ASSETS",
            "character_image"
          );

          // Parallel logic (fan-out)
          // const characterIds = characters.map(c => c.id);

          // const jobs: BatchJobs<'GENERATE_CHARACTER_ASSETS'> = characters.map((char, index) => ({
          //   uniqueKey: char.id,
          //   type: "GENERATE_CHARACTER_ASSETS",
          //   assetKey: "character_image",
          //   payload: {
          //     characters: [ char ],
          //     generationRules: project.generationRules,
          //   },
          // }));

          // const results = await this.dispatcher.ensureBatchJobs(nodeName, jobs);
          // const allUpdatedChars = results.flatMap(r => r.characters);
          // const updated = await this.projectRepository.updateCharacters(allUpdatedChars);

          // const charMap = new Map(updated.map(c => [ c.id, c ]));

          // const validIds: string[] = [];
          // const validUris: string[] = [];
          // const validMetadata: AssetVersion[ 'metadata' ][] = [];
          // const validTypes: AssetType[] = [];

          // characters.forEach(c => {
          //   const updatedChar = charMap.get(c.id);
          //   const assets = getAllBestFromAssets(updatedChar?.assets);
          //   const imageData = assets[ 'character_image' ]?.data;

          //   if (updatedChar && imageData) {
          //     validIds.push(updatedChar.id);
          //     validUris.push(imageData);
          //     validTypes.push('image');
          //     validMetadata.push({
          //       model: imageModelName,
          //       jobId: results.find(r => r.characters.some(rc => rc.id === c.id))?.jobId!,
          //     });
          //   }
          // });
          // if (validIds.length > 0) {
          //   await this.assetManager.createVersionedAssets(
          //     { projectId: this.projectId, characterIds: validIds },
          //     'character_image',
          //     validTypes,
          //     validUris,
          //     validMetadata,
          //     true
          //   );
          // }
          // updatedProject = await this.projectRepository.getProjectFullState(state.projectId);
          // this.publishStateUpdate(updatedProject, nodeName);
        }

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
        interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
      }
    }, {
      ends: [ "generate_location_assets", ]
    });

    workflow.addNode("generate_location_assets", async (state: WorkflowState) => {
      const nodeName = "generate_location_assets";
      console.log(`[${nodeName}]: Started`);

      console.log(` Generating Location References `);
      try {
        const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
        console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);

        if (executionMode === 'SEQUENTIAL') {
          await this.dispatcher.ensureJob(
            nodeName,
            "GENERATE_LOCATION_ASSETS",
            "location_image"
          );

        } else {

          await this.dispatcher.ensureJob(
            nodeName,
            "GENERATE_LOCATION_ASSETS",
            "location_image"
          );

          // const jobs: BatchJobs<"GENERATE_LOCATION_ASSETS"> = locations.map((loc, index) => ({
          //   id: this.jobControlPlane.jobId(this.projectId, nodeName, `loc-${loc.id}`),
          //   type: "GENERATE_LOCATION_ASSETS" as const,
          //   assetKey: "location_image",
          //   payload: {
          //     locations: [ loc ],
          //     generationRules: project.generationRules
          //   },
          // }));

          // const results = await this.dispatcher.ensureBatchJobs(nodeName, jobs);
          // const allUpdatedLocs = results.flatMap(r => r.locations);
          // const updated = await this.projectRepository.updateLocations(allUpdatedLocs);

          // const locMap = new Map(updated.map(l => [ l.id, l ]));

          // const validIds: string[] = [];
          // const validUris: string[] = [];
          // const validMetadata: AssetVersion[ 'metadata' ][] = [];
          // const validTypes: AssetType[] = [];

          // locations.forEach(l => {
          //   const updatedLoc = locMap.get(l.id);
          //   const assets = getAllBestFromAssets(updatedLoc?.assets);
          //   const imageData = assets[ 'location_image' ]?.data;

          //   if (updatedLoc && imageData) {
          //     validIds.push(updatedLoc.id);
          //     validUris.push(imageData);
          //     validTypes.push('image');
          //     validMetadata.push({
          //       model: imageModelName,
          //       jobId: results.find(r => r.locations.some(rl => rl.id === l.id))?.jobId!,
          //     });
          //   }
          // });
        }
        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
        interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
      }
    }, {
      ends: [ "generate_scene_assets", ]
    });

    workflow.addNode("generate_scene_assets", async (state: WorkflowState) => {
      const nodeName = "generate_scene_assets";
      console.log(`[${nodeName}]: Started`);

      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(` Generating Scene Reference Images...Attempt ${currentAttempt}`);
      try {
        // const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';
        // console.log(`[${nodeName}]: Executing in ${executionMode.toLowerCase()} mode.`);
        // const scenes = await this.projectRepository.getProjectScenes(state.projectId);

        // if (executionMode === 'SEQUENTIAL') {
        await this.dispatcher.ensureJob(
          nodeName,
          "GENERATE_SCENE_FRAMES",
          "scene_start_frame"
        );

        await this.dispatcher.ensureJob(
          nodeName,
          "GENERATE_SCENE_FRAMES",
          "scene_end_frame"
        );
        // } else {

        // const jobs = await Promise.all(scenes.flatMap((scene) => {
        //   const assetKeys = [ "scene_start_frame", "scene_end_frame" ] as const;
        //   return assetKeys.map(async (key) => {
        //     return {
        //       id: this.jobControlPlane.jobId(this.projectId, nodeName, `scene-${scene.id}-${key}`),
        //       type: "GENERATE_SCENE_FRAMES" as const,
        //       assetKey: key,
        //       payload: {
        //         sceneId: scene.id,
        //         sceneIndex: scene.sceneIndex,
        //       },
        //     };
        //   });
        // }));

        // const results = await this.dispatcher.ensureBatchJobs<"GENERATE_SCENE_FRAMES">(nodeName, jobs);
        // const allUpdatedScenes = results.flatMap(r => r.updatedScenes);
        // await this.projectRepository.updateScenes(allUpdatedScenes);
        // }

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
        interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
      }
    }, {
      ends: [ "process_scene", ]
    });

    workflow.addNode("process_scene", async (state: WorkflowState) => {

      const nodeName = "process_scene";
      const executionMode = process.env.EXECUTION_MODE || 'SEQUENTIAL';

      console.log(`[${nodeName}]: Processing Scene ${state.currentSceneIndex}. Executing in ${executionMode.toLowerCase()} mode.`);
      let project = await this.projectRepository.getProjectFullState(state.projectId);
      if (!project) throw new Error("No project state available");

      const { scenes } = project;

      if (executionMode === 'SEQUENTIAL') {
        const index = state.currentSceneIndex;
        if (index >= scenes.length) return state;

        const scene = scenes[ index ];
        const nextScene = scenes[ index + 1 ];

        const [ best ] = await this.assetManager.getBestVersion({ projectId: this.projectId, sceneId: scene.id }, 'scene_video');
        const videoUrl = best ? best.data : null;

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
          const nextSceneVideoExists = await this.storageManager.fileExists(nextScenePath);
          if (!nextSceneVideoExists) {
            shouldRenderScenes = true;
          } else {
            console.log(` ... Next scene (${nextScene.id}) also exists, skipping redundant stitch.`);
          }

          if (shouldRenderScenes) {
            const videoPaths = scenes.map(s => {
              const sceneVideoAssets = s.assets[ 'scene_video' ];
              return sceneVideoAssets?.versions[ sceneVideoAssets.best ].data;
            }).filter((uri): uri is string => !!uri);
            if (videoPaths.length === 0) {
              console.warn(`[${nodeName}]: No videos to render.`);
              return state;
            }

            await this.dispatcher.ensureJob(
              nodeName,
              "RENDER_VIDEO",
              "render_video",
              {
                videoPaths,
                audioGcsUri: project.metadata.audioGcsUri,
              },
            );
          }

          console.log(`[${nodeName}]: Completed (Skipped)\n`);
          return {
            ...state,
            __interrupt__: undefined,
            __interrupt_resolved__: false,
          };
        }

        console.log(`[${nodeName}]: Processing scene ${scene.sceneIndex} (${index + 1}/${scenes.length}).`);
        const [ next ] = await this.assetManager.getNextVersionNumber({ projectId: this.projectId, sceneId: scene.id }, 'scene_video');
        await this.dispatcher.ensureJob(
          nodeName,
          "GENERATE_SCENE_VIDEO",
          "scene_video",
          {
            sceneId: scene.id,
            sceneIndex: scene.sceneIndex,
            version: next,
            overridePrompt: shouldForceRegenerate,
          },
        );

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          currentSceneIndex: index + 1,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } else {
        // Parallel execution

        const jobs: any[] = [];
        await Promise.all(scenes.map(async (scene) => {

          const forceRegenerateIndex = project?.forceRegenerateSceneIds.findIndex(id => id === scene.id);
          const shouldForceRegenerate = forceRegenerateIndex !== -1;

          let videoExists = false;
          if (!shouldForceRegenerate) {
            const [ best ] = await this.assetManager.getBestVersion({ projectId: this.projectId, sceneId: scene.id }, 'scene_video');
            const videoUrl = best?.data;
            videoExists = !!videoUrl && await this.storageManager.fileExists(videoUrl);
            if (videoExists) console.log(`   ... Scene ${scene.id} video already exists, skipping.`);
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
                overridePrompt: shouldForceRegenerate
              },
            });
          }
        }));

        try {
          if (jobs.length > 0) {
            await this.dispatcher.ensureBatchJobs<"GENERATE_SCENE_VIDEO">(
              nodeName,
              jobs,
            );
          } else {
            console.log(`[${nodeName}]: All scenes skipped (already exist and not forced).`);
          }

          console.log(`[${nodeName}]: Completed\n`);
          return {
            ...state,
            __interrupt__: undefined,
            __interrupt_resolved__: false,
          };
        } catch (error: any) {
          const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
          interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
        }
      }
    }, {
      ends: [ "process_scene", "render_video", ]
    });

    workflow.addNode("render_video", async (state: WorkflowState) => {

      const nodeName = "render_video";
      let project = await this.projectRepository.getProjectFullState(state.projectId);
      if (!project) {
        throw new Error("Project not found");
      }
      const currentAttempt = (state.nodeAttempts?.[ nodeName ] || 0) + 1;
      console.log(`\n[${nodeName}]: Rendering Final Video...Attempt ${currentAttempt}`);
      try {

        const scenes = project.scenes;
        const videoPaths = scenes.map(s => {
          const sceneVideoAssets = s.assets[ 'scene_video' ];
          return sceneVideoAssets?.versions[ sceneVideoAssets.best ].data;
        }).filter((uri): uri is string => !!uri);
        if (videoPaths.length === 0) {
          console.warn(`[${nodeName}]: No videos to render.`);
          return state;
        }

        await this.dispatcher.ensureJob(
          nodeName,
          "RENDER_VIDEO",
          "render_video",
          {
            videoPaths,
            audioGcsUri: project.metadata.audioGcsUri,
          },
        );

        console.log(`[${nodeName}]: Completed\n`);
        return {
          ...state,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
        };
      } catch (error: any) {
        const errorContext = JSON.parse(JSON.stringify(error?.message as string))?.[ 0 ]?.value || error?.message;
        interceptNodeInterruptAndThrow(errorContext, nodeName, state.projectId, errorContext);
      }
    }, {
      ends: [ "finalize", ]
    });

    workflow.addNode("finalize", async (state: WorkflowState) => {
      const nodeName = "finalize";
      console.log(`[${nodeName}]: Started`);
      console.log(`\n✅ [finalize]: Finalizing...`);

      const project = await this.projectRepository.updateProject(state.projectId, { status: "complete" });
      const [ attempt ] = await this.assetManager.createVersionedAssets({ projectId: this.projectId }, 'final_output', 'text', [ JSON.stringify(project) ], {
        model: textModelName,
        jobId: ""
      });
      const objectPath = this.storageManager.getObjectPath({ type: "final_output", projectId: project.id, attempt: attempt.version });
      const uploaded = await this.storageManager.uploadJSON(
        project,
        objectPath
      );
      console.log(`\n🎉 Video generation complete!`);
      console.log(`   Output saved to: ${this.storageManager.getPublicUrl(uploaded)}`);
      this.publishStateUpdate(project, "finalize");
      console.log(`[${nodeName}]: Completed\n`);
      return {
        ...state,
        project,
        __interrupt__: undefined,
        __interrupt_resolved__: false,
      };
    });

    // workflow.addNode("error_handler", errorHandler, {
    //   ends: [
    //     "expand_creative_prompt",
    //     "generate_storyboard_exclusively_from_prompt",
    //     "create_scenes_from_audio",
    //     "enrich_storyboard_and_scenes",
    //     "semantic_analysis",
    //     "generate_character_assets",
    //     "generate_location_assets",
    //     "generate_scene_assets",
    //     "process_scene",
    //     "render_video",
    //     "finalize"
    //   ]
    // });

    return workflow;
  }
}
