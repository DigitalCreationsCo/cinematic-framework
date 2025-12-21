// ============================================================================
// CINEMATIC VIDEO FRAMEWORK - TypeScript Implementation
// Google Vertex AI + LangGraph + GCP Storage
// ============================================================================

import ffmpeg from "fluent-ffmpeg";
import ffmpegBin from "@ffmpeg-installer/ffmpeg";
import ffprobeBin from "@ffprobe-installer/ffprobe";

ffmpeg.setFfmpegPath(ffmpegBin.path);
ffmpeg.setFfprobePath(ffprobeBin.path);

import * as dotenv from "dotenv";
dotenv.config();

import { StateGraph, END, START, Command } from "@langchain/langgraph";
import {
  Storyboard,
  GraphState,
  GeneratedScene,
  InitialGraphState,
  SceneGenerationMetric,
  WorkflowMetrics,
  AttemptMetric,
} from "../shared/pipeline-types";
import { PipelineEvent } from "../shared/pubsub-types";
import { SceneGeneratorAgent } from "./agents/scene-generator";
import { CompositionalAgent } from "./agents/compositional-agent";
import { ContinuityManagerAgent } from "./agents/continuity-manager";
import { GCPStorageManager } from "./storage-manager";
import { FrameCompositionAgent } from "./agents/frame-composition-agent";
import { AudioProcessingAgent } from "./agents/audio-processing-agent";
import { LlmController, GoogleProvider } from "./llm/controller";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { defaultCreativePrompt } from "./prompts/default-creative-prompt";
import { imageModelName, textModelName, videoModelName } from "./llm/google/models";
import { calculateLearningTrends } from "./utils";
import { QualityCheckAgent } from "./agents/quality-check-agent";
import { CheckpointerManager } from "./checkpointer-manager";

export class CinematicVideoWorkflow {
  public graph: StateGraph<GraphState>;
  private compositionalAgent: CompositionalAgent;
  private continuityAgent: ContinuityManagerAgent;
  private sceneAgent: SceneGeneratorAgent;
  private storageManager: GCPStorageManager;
  private frameCompositionAgent: FrameCompositionAgent;
  private audioProcessingAgent: AudioProcessingAgent;
  private qualityAgent: QualityCheckAgent;
  private projectId: string;
  private videoId: string;
  private SCENE_GEN_COOLDOWN_MS = 30000;

  constructor(
    projectId: string,
    videoId: string,
    bucketName: string,
    location: string = "us-east1",
  ) {
    if (!projectId) throw Error("A projectId was not provided");

    if (!bucketName) throw Error("A bucket name was not provided");

    this.projectId = projectId;
    this.videoId = videoId;
    this.storageManager = new GCPStorageManager(projectId, videoId, bucketName);

    const llmWrapper = new LlmController();

    this.audioProcessingAgent = new AudioProcessingAgent(llmWrapper, this.storageManager);
    this.compositionalAgent = new CompositionalAgent(llmWrapper, this.storageManager);

    this.qualityAgent = new QualityCheckAgent(llmWrapper, this.storageManager, {
      enabled: process.env.ENABLE_QUALITY_CONTROL === "true" || true, // always enabled
    });

    this.frameCompositionAgent = new FrameCompositionAgent(
      llmWrapper,
      this.qualityAgent,
      this.storageManager
    );
    this.sceneAgent = new SceneGeneratorAgent(
      llmWrapper,
      this.qualityAgent,
      this.storageManager
    );
    this.continuityAgent = new ContinuityManagerAgent(
      llmWrapper,
      llmWrapper,
      this.frameCompositionAgent,
      this.qualityAgent,
      this.storageManager,
    );

    this.graph = this.buildGraph();
  }

  public publishEvent: (event: PipelineEvent) => Promise<void> = async () => { };

  private async publishStateUpdate(state: GraphState, nodeName: string) {
    await this.publishEvent({
      type: "FULL_STATE",
      projectId: this.videoId,
      payload: { state },
      timestamp: new Date().toISOString(),
    });
    console.log(`✓ Published state update after: ${nodeName}`);
  }

  private async performIncrementalStitching(
    storyboardState: Storyboard,
    audioGcsUri: string | undefined
  ) {
    const videoPaths = storyboardState.scenes
      .map(s => s.generatedVideo?.storageUri)
      .filter((url): url is string => !!url);

    if (videoPaths.length === 0) return undefined;

    try {
      return audioGcsUri
        ? await this.sceneAgent.stitchScenes(videoPaths, audioGcsUri)
        : await this.sceneAgent.stitchScenesWithoutAudio(videoPaths);
    } catch (error) {
      console.warn("   ⚠️ Incremental stitching failed:", error);
      return undefined;
    }
  }

  private buildGraph(): StateGraph<GraphState> {
    const workflow = new StateGraph<GraphState>({
      channels: {
        initialPrompt: null,
        creativePrompt: null,
        audioGcsUri: null,
        hasAudio: null,
        storyboard: null,
        storyboardState: null,
        currentSceneIndex: null,
        forceRegenerateSceneId: null,
        scenePromptOverrides: null,
        renderedVideo: null,
        errors: null,
        generationRules: null,
        refinedRules: null,
        metrics: {
          reducer: (x: any, y: any) => y,
          default: () => ({
            sceneMetrics: [],
            attemptMetrics: [],
            trendHistory: [],
            regression: {
              count: 0,
              sumX: 0,
              sumY_a: 0,
              sumY_q: 0,
              sumXY_a: 0,
              sumXY_q: 0,
              sumX2: 0,
            },
          }),
        },
      },
    });

    workflow.addNode("sync_state", async (state: GraphState) => {
      console.log("🔄 Syncing state with storage...");
      const scannedAttempts = await this.storageManager.scanCurrentAttempts();

      // Merge with existing state.attempts (max wins)
      const currentAttempts = state.attempts || {};
      const mergedAttempts = { ...currentAttempts };

      for (const [ key, value ] of Object.entries(scannedAttempts)) {
        if (!mergedAttempts[ key ] || value > mergedAttempts[ key ]) {
          mergedAttempts[ key ] = value;
        }
      }

      return {
        ...state,
        attempts: mergedAttempts
      };
    });

    workflow.addEdge(START, "sync_state");

    workflow.addConditionalEdges("sync_state", (state: InitialGraphState) => {
      if (state.storyboardState && state.storyboardState.scenes.some(s => s.generatedVideo)) {
        console.log("   Resuming workflow from process_scene...");
        return "process_scene";
      }

      if (state.storyboardState && (state.storyboardState.metadata as any).creativePrompt) return "generate_character_assets";

      return "expand_creative_prompt";
    });

    workflow.addNode("expand_creative_prompt", async (state: GraphState) => {
      let expandedPrompt: string;
      if (!state.creativePrompt) throw new Error("No creative prompt was provided");
      console.log("\n🎨 PHASE 0: Expanding Creative Prompt to Cinema Quality...");
      console.log(`   Original prompt: ${state.creativePrompt.substring(0, 100)}...`);

      expandedPrompt = await this.compositionalAgent.expandCreativePrompt(state.creativePrompt);

      console.log(`   ✓ Expanded to ${expandedPrompt.length} characters of cinematic detail`);

      const newState = {
        ...state,
        creativePrompt: expandedPrompt,
      };

      await this.publishStateUpdate(newState, "expand_creative_prompt");
      return newState;
    });

    workflow.addConditionalEdges("expand_creative_prompt" as any, (state: GraphState) => {
      if (state.hasAudio) {
        return "create_scenes_from_audio";
      }
      return "generate_storyboard_exclusively_from_prompt";
    });

    // Non-audio workflow path
    workflow.addEdge("generate_storyboard_exclusively_from_prompt" as any, "generate_character_assets" as any);

    workflow.addNode("generate_storyboard_exclusively_from_prompt", async (state: GraphState) => {
      if (!state.creativePrompt) throw new Error("No creative prompt available");
      console.log("\n📋 PHASE 1: Generating Storyboard from Creative Prompt (No Audio)...");

      let storyboard = await this.compositionalAgent.generateStoryboardFromPrompt(
        state.creativePrompt
      );

      const newState = {
        ...state,
        storyboard,
        storyboardState: storyboard,
        currentSceneIndex: 0,
      };

      await this.publishStateUpdate(newState, "generate_storyboard_exclusively_from_prompt");
      return newState;
    });

    // Audio-based workflow path
    workflow.addEdge("create_scenes_from_audio" as any, "enrich_storyboard_and_scenes" as any);
    workflow.addEdge("enrich_storyboard_and_scenes" as any, "generate_character_assets" as any);

    workflow.addNode("create_scenes_from_audio", async (state: GraphState) => {
      if (!state.creativePrompt) throw new Error("No creative prompt available");
      console.log("\n📋 PHASE 1a: Creating Timed Scenes from Audio...");
      const { segments, totalDuration } = await this.audioProcessingAgent.processAudioToScenes(
        state.initialPrompt,
        state.creativePrompt,
      );

      const newState = {
        ...state,
        storyboard: {
          metadata: {
            duration: totalDuration
          },
          scenes: segments,
        } as Storyboard,
      };

      await this.publishStateUpdate(newState, "create_scenes_from_audio");
      return newState;
    });

    workflow.addNode("enrich_storyboard_and_scenes", async (state: GraphState) => {
      if (!state.storyboard || !state.storyboard.scenes) throw new Error("No timed scenes available");
      if (!state.creativePrompt) throw new Error("No creative prompt available");

      console.log("\n📋 PHASE 1b: Enhancing Storyboard with Prompt...");
      let storyboard = await this.compositionalAgent.generateFullStoryboard(
        state.storyboard,
        state.creativePrompt,
        { initialDelay: 30000 }
      );

      const newState = {
        ...state,
        storyboard,
        storyboardState: storyboard,
        currentSceneIndex: 0,
      };

      await this.publishStateUpdate(newState, "enrich_storyboard_and_scenes");
      return newState;
    });

    workflow.addNode("generate_character_assets", async (state: GraphState) => {
      if (!state.storyboardState) throw new Error("No storyboard state available");

      // Initialize generation rules if not already set
      if (!state.generationRules || state.generationRules.length === 0) {
        const { detectRelevantDomainRules, getProactiveRules } = await import("./prompts/generation-rules-presets");

        const sceneDescriptions = state.storyboardState.scenes.map(s => s.description);
        const domainRules = detectRelevantDomainRules(sceneDescriptions);
        const proactiveRules = getProactiveRules();

        const allRules = [ ...proactiveRules, ...domainRules ];
        const uniqueRules = Array.from(new Set(allRules));

        console.log(`\n📚 GENERATION RULES INITIALIZED`);
        console.log(`   Proactive rules: ${proactiveRules.length}`);
        console.log(`   Domain-specific rules: ${domainRules.length}`);
        console.log(`   Total active rules: ${uniqueRules.length}`);

        state = {
          ...state,
          generationRules: uniqueRules
        };
      }

      console.log("\n🎨 PHASE 2a: Generating Character References...");

      const characters = await this.continuityAgent.generateCharacterAssets(
        state.storyboardState.characters
      );

      const newState = {
        ...state,
        storyboardState: {
          ...state.storyboardState,
          characters,
        }
      };

      await this.publishStateUpdate(newState, "generate_character_assets");
      return newState;
    });

    workflow.addNode("generate_location_assets", async (state: GraphState) => {
      if (!state.storyboardState) throw new Error("No storyboard state available");

      console.log("\n🎨 PHASE 2b: Generating Location References...");

      const locations = await this.continuityAgent.generateLocationAssets(
        state.storyboardState.locations
      );

      const newState = {
        ...state,
        storyboardState: {
          ...state.storyboardState,
          locations,
        }
      };

      await this.publishStateUpdate(newState, "generate_location_assets");
      return newState;
    });

    workflow.addNode("generate_scene_assets", async (state: GraphState) => {
      if (!state.storyboardState) throw new Error("No storyboard state available for frame generation.");

      console.log("\n🖼️ PHASE 2c: Generating Scene Start/End Frames...");

      const updatedScenes = await this.continuityAgent.generateSceneFramesBatch(
        state.storyboardState.scenes,
        state.storyboardState,
        state.generationRules,
      );

      const newState = {
        ...state,
        storyboardState: {
          ...state.storyboardState,
          scenes: updatedScenes,
        }
      };
      await this.publishStateUpdate(newState, "generate_scene_assets");
      return newState;
    });

    workflow.addNode("process_scene", async (state: GraphState) => {
      if (!state.storyboardState) {
        throw new Error("Missing storyboard state");
      }

      const scene = state.storyboardState.scenes[ state.currentSceneIndex ];
      console.log(
        `\n🎬 PHASE 3: Processing Scene ${scene.id}/${state.storyboardState.scenes.length}`
      );

      await this.publishEvent({
        type: "SCENE_STARTED",
        projectId: this.videoId,
        payload: {
          sceneId: scene.id,
          sceneIndex: state.currentSceneIndex,
          totalScenes: state.storyboardState.scenes.length,
        },
        timestamp: new Date().toISOString(),
      });

      const sceneVideoPath = await this.storageManager.getGcsObjectPath({ type: "scene_video", sceneId: scene.id });
      const shouldForceRegenerate = state.forceRegenerateSceneId === scene.id;

      if (!shouldForceRegenerate && await this.storageManager.fileExists(sceneVideoPath)) {
        console.log(`   ... Scene video already exists at ${sceneVideoPath}, skipping.`);

        await this.publishEvent({
          type: "SCENE_SKIPPED",
          projectId: this.videoId,
          payload: {
            sceneId: scene.id,
            reason: "Video already exists",
            videoUrl: this.storageManager.buildObjectData(sceneVideoPath).publicUri,
          },
          timestamp: new Date().toISOString(),
        });

        const generatedScene = {
          ...scene,
          generatedVideo: this.storageManager.buildObjectData(sceneVideoPath),
        } as GeneratedScene;

        const updatedStoryboardState = this.continuityAgent.updateStoryboardState(
          generatedScene,
          state.storyboardState
        );

        // Conditional Incremental Stitching:
        // Only stitch if we are at the end of the existing chain or this is the final scene.
        const isLastScene = state.currentSceneIndex === state.storyboardState.scenes.length - 1;
        let shouldStitch = isLastScene;

        if (!shouldStitch) {
          // Check if the next scene already exists in storage.
          // If it does, we can skip stitching now and wait for the next iteration.
          // If it doesn't, we should stitch so the user has the latest view up to this point.
          const nextSceneId = state.storyboardState.scenes[ state.currentSceneIndex + 1 ].id;
          const nextScenePath = await this.storageManager.getGcsObjectPath({ type: "scene_video", sceneId: nextSceneId });
          const nextExists = await this.storageManager.fileExists(nextScenePath);
          if (!nextExists) {
            shouldStitch = true;
          } else {
            console.log(`   ... Next scene (${nextSceneId}) also exists, skipping redundant stitch.`);
          }
        }

        let renderedVideo = state.renderedVideo;
        if (shouldStitch) {
          renderedVideo = await this.performIncrementalStitching(
            updatedStoryboardState,
            state.audioGcsUri
          );
        }

        const newState = {
          ...state,
          currentSceneIndex: state.currentSceneIndex + 1,
          storyboardState: updatedStoryboardState,
          forceRegenerateSceneId: undefined,
          renderedVideo: renderedVideo || state.renderedVideo,
        };
        await this.publishStateUpdate(newState, "process_scene");
        return newState;
      }

      const {
        enhancedPrompt,
        refinedRules,
        characterReferenceImages,
        locationReferenceImages,
        location
      } = await this.continuityAgent.prepareAndRefineSceneInputs(scene, state);

      let currentMetrics: WorkflowMetrics = state.metrics || {
        sceneMetrics: [],
        attemptMetrics: [],
        trendHistory: [],
        regression: { count: 0, sumX: 0, sumY_a: 0, sumY_q: 0, sumXY_a: 0, sumXY_q: 0, sumX2: 0 },
      };

      const onAttemptComplete = (attempt: AttemptMetric) => {
        const updated = calculateLearningTrends(currentMetrics, attempt);
        currentMetrics = updated;

        const latestTrend = updated.globalTrend;
        if (latestTrend) {
          console.log(`\n🧠 Learning Report (Generation ${updated.attemptMetrics.length}):`);
          console.log(`   - Quality Trend Slope: ${latestTrend.qualityTrendSlope.toFixed(3)} (${latestTrend.qualityTrendSlope > 0 ? 'Improving' : 'Worsening or Stable'})`);
        }
      };

      // Use scene.startFrame directly for previousFrameUrl and scene.endFrame for config.lastFrame
      const result = await this.sceneAgent.generateSceneWithQualityCheck(
        scene,
        enhancedPrompt,
        state.storyboardState.characters,
        location,
        state.storyboardState.scenes[ state.currentSceneIndex - 1 ], // Previous scene object
        state.attempts?.[ `scene_video_${scene.id}` ] || 0,
        scene.startFrame, // Use pre-generated startFrame as previousFrameUrl for video generation
        scene.endFrame, // Pass pre-generated endFrame to scene generation
        characterReferenceImages,
        locationReferenceImages,
        !state.hasAudio,
        onAttemptComplete
      );

      if (result.evaluation) {
        console.log(`   📊 Final: ${(result.finalScore * 100).toFixed(1)}% after ${result.attempts} attempt(s)`);
      }

      console.log(`   ... waiting ${this.SCENE_GEN_COOLDOWN_MS / 1000}s for rate limit reset`);
      await new Promise(resolve => setTimeout(resolve, this.SCENE_GEN_COOLDOWN_MS));

      result.scene.evaluation = result.evaluation ?? undefined;

      const updatedStoryboardState = this.continuityAgent.updateStoryboardState(
        result.scene,
        state.storyboardState
      );

      const newGenerationRules = result.evaluation?.ruleSuggestion
        ? [ ...(state.generationRules || []), result.evaluation.ruleSuggestion ]
        : state.generationRules;

      // Log when a new generation rule is added
      if (result.evaluation?.ruleSuggestion) {
        console.log(`\n📚 GENERATION RULE ADDED (Total: ${newGenerationRules.length})`);
        console.log(`   "${result.evaluation.ruleSuggestion}"`);
      }

      const sceneMetric: SceneGenerationMetric = {
        sceneId: scene.id,
        attempts: result.attempts,
        bestAttempt: result.attempts,
        finalScore: result.finalScore,
        duration: scene.duration,
        ruleAdded: !!result.evaluation?.ruleSuggestion
      };

      currentMetrics.sceneMetrics.push(sceneMetric);

      const renderedVideo = await this.performIncrementalStitching(
        updatedStoryboardState,
        state.audioGcsUri
      );

      await this.publishEvent({
        type: "SCENE_COMPLETED",
        projectId: this.videoId,
        payload: {
          sceneId: scene.id,
          sceneIndex: state.currentSceneIndex,
          videoUrl: result.scene.generatedVideo.publicUri,
        },
        timestamp: new Date().toISOString(),
      });

      delete state.scenePromptOverrides?.[ scene.id ];

      const newAttempts = { ...(state.attempts || {}) };
      if (result.usedAttempt) {
        newAttempts[ `scene_video_${scene.id}` ] = result.usedAttempt;
        newAttempts[ `scene_start_frame_${scene.id}` ] = result.usedAttempt;
        newAttempts[ `scene_end_frame_${scene.id}` ] = result.usedAttempt;
      }

      const newState = {
        ...state,
        currentSceneIndex: state.currentSceneIndex + 1,
        forceRegenerateSceneId: undefined,
        storyboardState: updatedStoryboardState,
        generationRules: newGenerationRules,
        refinedRules: refinedRules,
        metrics: currentMetrics,
        renderedVideo: renderedVideo || state.renderedVideo,
        attempts: newAttempts,
      };

      await this.publishStateUpdate(newState, "process_scene");
      return newState;
    });

    workflow.addNode("render_video", async (state: GraphState) => {
      console.log("\n🎥 PHASE 4: Rendering Final Video...");
      if (!state.storyboardState) return state;

      const videoPaths = state.storyboardState.scenes
        .map(s => s.generatedVideo?.storageUri)
        .filter((url): url is string => !!url);

      if (videoPaths.length === 0) {
        console.warn("   No videos to stitch.");
        await this.publishStateUpdate(state, "render_video");
        return state;
      }

      try {
        // If audio is available, stitch with audio; otherwise, stitch without audio
        const renderedVideo = state.audioGcsUri
          ? await this.sceneAgent.stitchScenes(videoPaths, state.audioGcsUri)
          : await this.sceneAgent.stitchScenesWithoutAudio(videoPaths);

        const newState = {
          ...state,
          renderedVideo
        };

        await this.publishStateUpdate(newState, "render_video");
        return newState;
      } catch (error) {
        console.error("   Failed to render video:", error);

        const newState = {
          ...state,
          errors: [ ...state.errors, `Video rendering failed: ${error}` ]
        };
        await this.publishStateUpdate(newState, "render_video");
        return newState;
      }
    });

    workflow.addNode("finalize", async (state: GraphState) => {
      console.log("\n✅ PHASE 4: Finalizing Workflow...");
      console.log(`   Total scenes generated: ${state.storyboardState?.scenes.length}`);

      const outputPath = await this.storageManager.getGcsObjectPath({ type: "final_output" });
      await this.storageManager.uploadJSON(
        state.storyboardState || {},
        outputPath
      );

      console.log(`\n🎉 Video generation complete!`);
      console.log(`   Output saved to: ${outputPath}`);

      await this.publishStateUpdate(state, "finalize");

      return state;
    });

    workflow.addEdge("generate_character_assets" as any, "generate_location_assets" as any);
    workflow.addEdge("generate_location_assets" as any, "generate_scene_assets" as any);
    workflow.addEdge("generate_scene_assets" as any, "process_scene" as any);

    workflow.addConditionalEdges("process_scene" as any, (state: GraphState) => {
      if (!state.storyboardState) return "finalize";
      if (state.currentSceneIndex >= state.storyboardState.scenes.length) {
        return "render_video";
      }
      return "process_scene";
    });

    workflow.addEdge("render_video" as any, "finalize" as any);
    workflow.addEdge("finalize" as any, END);

    return workflow;
  }

  async execute(localAudioPath: string | undefined, creativePrompt: string, postgresUrl: string): Promise<GraphState> {
    console.log(`🚀 Executing Cinematic Video Generation Workflow for videoId: ${this.videoId}`);
    console.log(` Text generation model: ${textModelName}`);
    console.log(` Image generation model: ${imageModelName}`);
    console.log(` Video generation model: ${videoModelName}`);
    console.log("=".repeat(60));

    // Initialize storage manager to sync state from GCS
    await this.storageManager.initialize();

    let initialState: InitialGraphState;
    let audioGcsUri: string | undefined;
    const hasAudio = !!localAudioPath;

    if (hasAudio && localAudioPath) {
      console.log("   Checking for existing audio file...");
      audioGcsUri = await this.storageManager.uploadAudioFile(localAudioPath);
    } else {
      console.log("   No audio file provided - generating video from creative prompt only.");
    }

    const audioPublicUri = audioGcsUri ? this.storageManager.getPublicUrl(audioGcsUri) : undefined;

    const checkpointerManager = new CheckpointerManager(postgresUrl);
    await checkpointerManager.init();

    let checkpointer = checkpointerManager.getCheckpointer();
    if (false) {
      console.log("   Persistence enabled via Checkpointer. Bypassing GCS load for initial state.");

      initialState = {
        initialPrompt: localAudioPath || '',
        creativePrompt, // Must be provided if starting fresh, checkpointer will override if resuming
        hasAudio,
        audioGcsUri,
        currentSceneIndex: 0,
        errors: [],
        generationRules: [],
        refinedRules: [],
        attempts: await this.storageManager.scanCurrentAttempts(),
      };
    } else {
      console.log("   No checkpointer found. Checking GCS for existing storyboard.");
      try {
        console.log("   Checking for existing storyboard...");
        const storyboardPath = await this.storageManager.getGcsObjectPath({ type: "storyboard" });
        const storyboard = await this.storageManager.downloadJSON<Storyboard>(storyboardPath);
        console.log("   Found existing storyboard. Resuming workflow.");

        initialState = {
          initialPrompt: localAudioPath || '',
          creativePrompt: creativePrompt || '',
          hasAudio,
          storyboard,
          storyboardState: storyboard,
          currentSceneIndex: 0,
          audioGcsUri,
          audioPublicUri,
          errors: [],
          generationRules: [],
          refinedRules: [],
          attempts: await this.storageManager.scanCurrentAttempts(),
        };
      } catch (error) {
        console.error("Error loading from GCS: ", error);
        console.log("   No existing storyboard found or error loading it. Starting fresh workflow.");
        if (!creativePrompt) {
          throw new Error("Cannot start new workflow without creativePrompt.");
        }

        initialState = {
          initialPrompt: localAudioPath || '',
          creativePrompt,
          hasAudio,
          currentSceneIndex: 0,
          audioGcsUri,
          audioPublicUri,
          errors: [],
          generationRules: [],
          refinedRules: [],
          attempts: await this.storageManager.scanCurrentAttempts(),
        };
      }
    }

    const compiledGraph = this.graph.compile({ checkpointer });
    const result = await compiledGraph.invoke(initialState, {
      configurable: { thread_id: this.videoId },
      recursionLimit: 100,
    });

    return result as GraphState;
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const projectId = process.env.GCP_PROJECT_ID!;
  const bucketName = process.env.GCP_BUCKET_NAME!;
  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl) {
    throw new Error("Postgres URL is required for CheckpointerManager initialization");
  }
  const LOCAL_AUDIO_PATH = process.env.LOCAL_AUDIO_PATH;

  const argv = await yargs(hideBin(process.argv))
    .option("id", {
      alias: [ "resume", "videoId" ],
      type: "string",
      description: "Video ID to resume or use",
    })
    .option("audio", {
      alias: [ "file", "audioPath" ],
      type: "string",
      description: "Path to local audio file",
    })
    .option("prompt", {
      alias: "creativePrompt",
      type: "string",
      description: "Creative prompt for the video",
    })
    .help()
    .argv;

  const videoId = argv.id || `video_${Date.now()}`;
  const audioPath = argv.audio || LOCAL_AUDIO_PATH || undefined;

  const workflow = new CinematicVideoWorkflow(projectId, videoId, bucketName);

  const creativePrompt = argv.prompt || defaultCreativePrompt;

  try {
    const result = await workflow.execute(audioPath, creativePrompt, postgresUrl);
    console.log("\n" + "=".repeat(60));
    console.log("✅ Workflow completed successfully!");
    console.log(`   Generated ${result.storyboardState.scenes.length} scenes`);
  } catch (error) {
    console.error("\n❌ Workflow failed:", error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
