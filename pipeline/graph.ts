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

import { StateGraph, END, START, Command, NodeInterrupt } from "@langchain/langgraph";
import {
  Storyboard,
  GraphState,
  LlmRetryInterruptValue,
  GeneratedScene,
  InitialGraphState,
  SceneGenerationMetric,
  WorkflowMetrics,
  AttemptMetric,
  ObjectData,
  SceneStatus,
  Scene,
} from "../shared/pipeline-types";
import { PipelineEvent } from "../shared/pubsub-types";
import { SceneGeneratorAgent } from "./agents/scene-generator";
import { CompositionalAgent } from "./agents/compositional-agent";
import { ContinuityManagerAgent } from "./agents/continuity-manager";
import { GCPStorageManager } from "./storage-manager";
import { FrameCompositionAgent } from "./agents/frame-composition-agent";
import { AudioProcessingAgent } from "./agents/audio-processing-agent";
import { SemanticExpertAgent } from "./agents/semantic-expert-agent";
import { LlmController, GoogleProvider } from "./llm/controller";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { defaultCreativePrompt } from "./prompts/default-creative-prompt";
import { imageModelName, textModelName, videoModelName } from "./llm/google/models";
import { calculateLearningTrends, deleteBogusUrls } from "./utils";
import { QualityCheckAgent } from "./agents/quality-check-agent";
import { CheckpointerManager } from "./checkpointer-manager";
import { RunnableConfig } from "@langchain/core/runnables";
import { extractErrorDetails, extractErrorMessage } from "./lib/errors";

export class CinematicVideoWorkflow {
  public graph: StateGraph<GraphState>;
  private compositionalAgent: CompositionalAgent;
  private continuityAgent: ContinuityManagerAgent;
  private sceneAgent: SceneGeneratorAgent;
  private storageManager: GCPStorageManager;
  private frameCompositionAgent: FrameCompositionAgent;
  private audioProcessingAgent: AudioProcessingAgent;
  private qualityAgent: QualityCheckAgent;
  private semanticExpert: SemanticExpertAgent;
  private projectId: string;
  private videoId: string;
  private SCENE_GEN_COOLDOWN_MS = 30000;
  private controller?: AbortController;

  constructor(
    projectId: string,
    videoId: string,
    bucketName: string,
    controller?: AbortController,
    location: string = "us-east1",
  ) {
    if (!projectId) throw Error("A projectId was not provided");

    if (!bucketName) throw Error("A bucket name was not provided");

    this.projectId = projectId;
    this.videoId = videoId;
    this.controller = controller;
    this.storageManager = new GCPStorageManager(projectId, videoId, bucketName);

    const llmWrapper = new LlmController();
    const agentOptions = { signal: this.controller?.signal };

    this.audioProcessingAgent = new AudioProcessingAgent(llmWrapper, this.storageManager, agentOptions);
    this.compositionalAgent = new CompositionalAgent(llmWrapper, this.storageManager, agentOptions);

    this.qualityAgent = new QualityCheckAgent(llmWrapper, this.storageManager, {
      enabled: process.env.ENABLE_QUALITY_CONTROL === "true" || true, // always enabled
    }, agentOptions);

    this.semanticExpert = new SemanticExpertAgent(llmWrapper);

    this.frameCompositionAgent = new FrameCompositionAgent(
      llmWrapper,
      llmWrapper,
      this.qualityAgent,
      this.storageManager,
      agentOptions
    );
    this.sceneAgent = new SceneGeneratorAgent(
      llmWrapper,
      this.qualityAgent,
      this.storageManager,
      agentOptions
    );
    this.continuityAgent = new ContinuityManagerAgent(
      llmWrapper,
      llmWrapper,
      this.frameCompositionAgent,
      this.qualityAgent,
      this.storageManager,
      agentOptions
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

  private async saveStateToStorage(state: GraphState) {
    try {
      const statePath = await this.storageManager.getGcsObjectPath({ type: "state" });
      await this.storageManager.uploadJSON(state, statePath);
      console.log(`   💾 Saved persistent state to ${statePath}`);
    } catch (error) {
      console.warn("   ⚠️ Failed to save persistent state to storage:", error);
    }
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
        localAudioPath: null,
        creativePrompt: null,
        audioGcsUri: null,
        audioPublicUri: null,
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
        attempts: null,
        __interrupt__: null,
        __interrupt_resolved__: null,
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

      // Populate best attempts from storyboard state if available
      const bestAttempts: Record<string, number> = {};
      if (state.storyboardState?.scenes) {
        for (const scene of state.storyboardState.scenes) {
          if (scene.bestAttempt) {
            bestAttempts[ `scene_video_${scene.id}` ] = scene.bestAttempt;
            bestAttempts[ `scene_start_frame_${scene.id}` ] = scene.bestAttempt;
            bestAttempts[ `scene_end_frame_${scene.id}` ] = scene.bestAttempt;
          }
        }
      }

      // Initialize storage manager with synced state
      this.storageManager.initializeAttempts(mergedAttempts, bestAttempts);

      return {
        ...state,
        attempts: mergedAttempts
      };
    });

    workflow.addEdge(START, "sync_state" as any);

    workflow.addConditionalEdges("sync_state" as any, (state: InitialGraphState) => {
      if (state.storyboardState && state.storyboardState.scenes.some(s => s.generatedVideo?.storageUri)) {
        console.log("   Resuming workflow from process_scene...");
        return "process_scene";
      }

      if (state.storyboardState && (state.storyboardState.metadata as any).creativePrompt) return "generate_character_assets";

      return "expand_creative_prompt";
    });

    workflow.addNode("expand_creative_prompt", async (state: GraphState) => {
      const nodeName = "expand_creative_prompt";
      const maxRetries = 3;
      // We track attempts in the attempts map with a key specific to this node
      const currentAttempt = (state.attempts?.[ nodeName ] || 0) + 1;

      try {
        let expandedPrompt: string;
        if (!state.creativePrompt) throw new Error("No creative prompt was provided");
        console.log("\n🎨 PHASE 0: Expanding Creative Prompt to Cinema Quality...");
        console.log(`   Original prompt: ${state.creativePrompt.substring(0, 100)}...`);

        expandedPrompt = await this.compositionalAgent.expandCreativePrompt(state.creativePrompt);

        console.log(`   ✓ Expanded to ${expandedPrompt.length} characters of cinematic detail`);

        const newState = {
          ...state,
          creativePrompt: expandedPrompt,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
          attempts: {
            ...state.attempts,
            [ nodeName ]: 0 // Reset attempt counter on success
          }
        };

        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "expand_creative_prompt");
        return newState;

      } catch (error) {
        console.error(`[${nodeName}] Error on attempt ${currentAttempt}:`, error);

        const errorMessage = extractErrorMessage(error);
        const errorDetails = extractErrorDetails(error);

        const interruptValue: LlmRetryInterruptValue = {
          type: currentAttempt >= maxRetries ? 'llm_retry_exhausted' : 'llm_intervention',
          error: errorMessage,
          errorDetails: errorDetails,
          functionName: 'expandCreativePrompt',
          nodeName: nodeName,
          params: {
            creativePrompt: state.creativePrompt
          },
          attemptCount: currentAttempt,
          lastAttemptTimestamp: new Date().toISOString(),
          stackTrace: error instanceof Error ? error.stack : undefined
        };

        throw new NodeInterrupt(interruptValue);
      }
    });

    workflow.addConditionalEdges("expand_creative_prompt" as any, (state: GraphState) => {
      if (state.hasAudio) {
        return "create_scenes_from_audio";
      }
      return "generate_storyboard_exclusively_from_prompt";
    });

    // Non-audio workflow path
    workflow.addEdge("generate_storyboard_exclusively_from_prompt" as any, "semantic_analysis" as any);

    workflow.addNode("generate_storyboard_exclusively_from_prompt", async (state: GraphState) => {
      const nodeName = "generate_storyboard_exclusively_from_prompt";
      const maxRetries = 3;
      const currentAttempt = (state.attempts?.[ nodeName ] || 0) + 1;

      try {
        if (!state.creativePrompt) throw new Error("No creative prompt available");
        console.log("\n📋 PHASE 1: Generating Storyboard from Creative Prompt (No Audio)...");

        let storyboard = await this.compositionalAgent.generateStoryboardFromPrompt(
          state.creativePrompt
        );

        storyboard = deleteBogusUrls(storyboard);

        const newState = {
          ...state,
          storyboard,
          storyboardState: storyboard,
          currentSceneIndex: 0,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
          attempts: {
            ...state.attempts,
            [ nodeName ]: 0
          }
        };

        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "generate_storyboard_exclusively_from_prompt");
        return newState;
      } catch (error) {
        console.error(`[${nodeName}] Error on attempt ${currentAttempt}:`, error);

        const errorMessage = extractErrorMessage(error);
        const errorDetails = extractErrorDetails(error);

        const interruptValue: LlmRetryInterruptValue = {
          type: currentAttempt >= maxRetries ? 'llm_retry_exhausted' : 'llm_intervention',
          error: errorMessage,
          errorDetails: errorDetails,
          functionName: 'generateStoryboardFromPrompt',
          nodeName: nodeName,
          params: { creativePrompt: state.creativePrompt },
          attemptCount: currentAttempt,
          lastAttemptTimestamp: new Date().toISOString(),
          stackTrace: error instanceof Error ? error.stack : undefined
        };

        throw new NodeInterrupt(interruptValue);
      }
    });

    // Audio-based workflow path
    workflow.addEdge("create_scenes_from_audio" as any, "enrich_storyboard_and_scenes" as any);
    workflow.addEdge("enrich_storyboard_and_scenes" as any, "semantic_analysis" as any);

    workflow.addNode("create_scenes_from_audio", async (state: GraphState) => {
      const nodeName = "create_scenes_from_audio";
      const maxRetries = 3;
      const currentAttempt = (state.attempts?.[ nodeName ] || 0) + 1;

      try {
        if (!state.creativePrompt) throw new Error("No creative prompt available");
        console.log("\n📋 PHASE 1a: Creating Timed Scenes from Audio...");
        const { segments, totalDuration } = await this.audioProcessingAgent.processAudioToScenes(
          state.audioPublicUri,
          state.creativePrompt,
        );

        let storyboard: Storyboard = {
          metadata: {
            duration: totalDuration,
          } as any, // Partial metadata is acceptable at this stage
          scenes: segments as Scene[],
          characters: [],
          locations: []
        };

        storyboard = deleteBogusUrls(storyboard);

        const newState = {
          ...state,
          storyboard: storyboard,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
          attempts: {
            ...state.attempts,
            [ nodeName ]: 0
          }
        };

        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "create_scenes_from_audio");
        return newState;
      } catch (error) {
        console.error(`[${nodeName}] Error on attempt ${currentAttempt}:`, error);

        const errorMessage = extractErrorMessage(error);
        const errorDetails = extractErrorDetails(error);

        const interruptValue: LlmRetryInterruptValue = {
          error: errorMessage,
          errorDetails: errorDetails,
          type: currentAttempt >= maxRetries ? 'llm_retry_exhausted' : 'llm_intervention',
          functionName: 'processAudioToScenes',
          nodeName: nodeName,
          params: {
            audioPublicUri: state.audioPublicUri,
            creativePrompt: state.creativePrompt
          },
          attemptCount: currentAttempt,
          lastAttemptTimestamp: new Date().toISOString(),
          stackTrace: error instanceof Error ? error.stack : undefined
        };

        throw new NodeInterrupt(interruptValue);
      }
    });

    workflow.addNode("semantic_analysis", async (state: GraphState) => {
      const nodeName = "semantic_analysis";
      const currentAttempt = (state.attempts?.[ nodeName ] || 0) + 1;

      try {
        if (!state.storyboardState) throw new Error("No storyboard state available");

        console.log("\n🧠 PHASE 1c: Semantic Rule Analysis...");

        const { getProactiveRules } = await import("./prompts/generation-rules-presets");
        const proactiveRules = getProactiveRules();

        const dynamicRules = await this.semanticExpert.generateRules(state.storyboardState);

        const allRules = [ ...proactiveRules, ...dynamicRules ];
        const uniqueRules = Array.from(new Set(allRules));

        console.log(`   📚 Rules Initialized: ${proactiveRules.length} Global, ${dynamicRules.length} Semantic.`);

        const newState = {
          ...state,
          generationRules: uniqueRules,
          refinedRules: uniqueRules,
          attempts: {
            ...state.attempts,
            [ nodeName ]: 0
          }
        };

        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "semantic_analysis");
        return newState;

      } catch (error) {
        console.error(`[${nodeName}] Error on attempt ${currentAttempt}:`, error);
        console.log('Falling back to generation rules presets')
        const { getProactiveRules } = await import("./prompts/generation-rules-presets");
        return {
          ...state,
          generationRules: getProactiveRules(),
          attempts: { ...state.attempts, [ nodeName ]: 0 } 
        };
      }
    });

    workflow.addNode("enrich_storyboard_and_scenes", async (state: GraphState) => {
      const nodeName = "enrich_storyboard_and_scenes";
      const maxRetries = 3;
      const currentAttempt = (state.attempts?.[ nodeName ] || 0) + 1;

      try {
        if (!state.storyboard || !state.storyboard.scenes) throw new Error("No timed scenes available");
        if (!state.creativePrompt) throw new Error("No creative prompt available");

        console.log("\n📋 PHASE 1b: Enhancing Storyboard with Prompt...");
        let storyboard = await this.compositionalAgent.generateFullStoryboard(
          state.storyboard,
          state.creativePrompt,
          { initialDelay: 30000 }
        );

        storyboard = deleteBogusUrls(storyboard);

        const newState = {
          ...state,
          storyboard,
          storyboardState: storyboard,
          currentSceneIndex: 0,
          __interrupt__: undefined,
          __interrupt_resolved__: false,
          attempts: {
            ...state.attempts,
            [ nodeName ]: 0
          }
        };

        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "enrich_storyboard_and_scenes");
        return newState;
      } catch (error) {
        console.error(`[${nodeName}] Error on attempt ${currentAttempt}:`, error);

        const errorMessage = extractErrorMessage(error);
        const errorDetails = extractErrorDetails(error);

        const interruptValue: LlmRetryInterruptValue = {
          error: errorMessage,
          errorDetails: errorDetails,
          type: currentAttempt >= maxRetries ? 'llm_retry_exhausted' : 'llm_intervention',
          functionName: 'generateFullStoryboard',
          nodeName: nodeName,
          params: {
            creativePrompt: state.creativePrompt
          },
          attemptCount: currentAttempt,
          lastAttemptTimestamp: new Date().toISOString(),
          stackTrace: error instanceof Error ? error.stack : undefined
        };

        throw new NodeInterrupt(interruptValue);
      }
    });

    workflow.addNode("generate_character_assets", async (state: GraphState) => {
      const nodeName = "generate_character_assets";
      const maxRetries = 3;
      const currentAttempt = (state.attempts?.[ nodeName ] || 0) + 1;

      try {
        if (!state.storyboardState) throw new Error("No storyboard state available");

        console.log("\n🎨 PHASE 2a: Generating Character References...");

        const characters = await this.continuityAgent.generateCharacterAssets(
          state.storyboardState.characters,
        );

        const newState = {
          ...state,
          storyboardState: {
            ...state.storyboardState,
            characters,
          },
          __interrupt__: undefined,
          __interrupt_resolved__: false,
          attempts: {
            ...state.attempts,
            [ nodeName ]: 0
          }
        };

        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "generate_character_assets");
        return newState;
      } catch (error) {
        console.error(`[${nodeName}] Error on attempt ${currentAttempt}:`, error);

        const errorMessage = extractErrorMessage(error);
        const errorDetails = extractErrorDetails(error);

        const interruptValue: LlmRetryInterruptValue = {
          error: errorMessage,
          errorDetails: errorDetails,
          type: currentAttempt >= maxRetries ? 'llm_retry_exhausted' : 'llm_intervention',
          functionName: 'generateCharacterAssets',
          nodeName: nodeName,
          params: {
            characters: state.storyboardState.characters,
            sceneDescriptions: state.storyboardState.scenes.map(s => s.description),
          },
          attemptCount: currentAttempt,
          lastAttemptTimestamp: new Date().toISOString(),
          stackTrace: error instanceof Error ? error.stack : undefined
        };

        throw new NodeInterrupt(interruptValue);
      }
    });

    workflow.addNode("generate_location_assets", async (state: GraphState) => {
      const nodeName = "generate_location_assets";
      const maxRetries = 3;
      const currentAttempt = (state.attempts?.[ nodeName ] || 0) + 1;

      try {
        if (!state.storyboardState) throw new Error("No storyboard state available");

        console.log("\n🎨 PHASE 2b: Generating Location References...");

        const locations = await this.continuityAgent.generateLocationAssets(
          state.storyboardState.locations,
        );

        const newState = {
          ...state,
          storyboardState: {
            ...state.storyboardState,
            locations,
          },
          __interrupt__: undefined,
          __interrupt_resolved__: false,
          attempts: {
            ...state.attempts,
            [ nodeName ]: 0
          }
        };

        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "generate_location_assets");
        return newState;
      } catch (error) {
        console.error(`[${nodeName}] Error on attempt ${currentAttempt}:`, error);

        const errorMessage = extractErrorMessage(error);
        const errorDetails = extractErrorDetails(error);

        const interruptValue: LlmRetryInterruptValue = {
          type: currentAttempt >= maxRetries ? 'llm_retry_exhausted' : 'llm_intervention',
          error: errorMessage,
          errorDetails: errorDetails,
          params: {
            locations: state.storyboardState.locations,
          },
          functionName: 'generateLocationAssets',
          nodeName: nodeName,
          attemptCount: currentAttempt,
          lastAttemptTimestamp: new Date().toISOString(),
          stackTrace: error instanceof Error ? error.stack : undefined
        };

        throw new NodeInterrupt(interruptValue);
      }
    });

    workflow.addNode("generate_scene_assets", async (state: GraphState) => {
      const nodeName = "generate_scene_assets";
      const maxRetries = 3;
      const currentAttempt = (state.attempts?.[ nodeName ] || 0) + 1;

      try {
        if (!state.storyboardState) throw new Error("No storyboard state available for frame generation.");

        console.log("\n🖼️ PHASE 2c: Generating Scene Start/End Frames...");

        const onProgress = async (sceneId: number, msg: string, status?: SceneStatus, artifacts?: { startFrame?: ObjectData, endFrame?: ObjectData; }) => {
          await this.publishEvent({
            type: "SCENE_PROGRESS",
            projectId: this.videoId,
            payload: { sceneId, status, progressMessage: msg, ...artifacts },
            timestamp: new Date().toISOString(),
          });
        };

        const updatedScenes = await this.continuityAgent.generateSceneFramesBatch(
          state.storyboardState.scenes,
          state.storyboardState,
          state.generationRules,
          onProgress
        );

        const newState = {
          ...state,
          storyboardState: {
            ...state.storyboardState,
            scenes: updatedScenes,
          },
          __interrupt__: undefined,
          __interrupt_resolved__: false,
          attempts: {
            ...state.attempts,
            [ nodeName ]: 0
          }
        };
        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "generate_scene_assets");
        return newState;
      } catch (error) {
        console.error(`[${nodeName}] Error on attempt ${currentAttempt}:`, error);

        const errorMessage = extractErrorMessage(error);
        const errorDetails = extractErrorDetails(error);

        const interruptValue: LlmRetryInterruptValue = {
          type: currentAttempt >= maxRetries ? 'llm_retry_exhausted' : 'llm_intervention',
          error: errorMessage,
          errorDetails: errorDetails,
          params: {
            scenes: state.storyboardState.scenes,
          },
          functionName: 'generateSceneFramesBatch',
          nodeName: nodeName,
          attemptCount: currentAttempt,
          lastAttemptTimestamp: new Date().toISOString(),
          stackTrace: error instanceof Error ? error.stack : undefined
        };

        throw new NodeInterrupt(interruptValue);
      }
    });

    workflow.addNode("process_scene", async (state: GraphState) => {
      const nodeName = "process_scene";
      const maxRetries = 3;
      // We track node-level attempts in a generic key, resetting on success
      // Note: This is separate from the internal scene generation retry logic
      const currentAttempt = (state.attempts?.[ nodeName ] || 0) + 1;

      try {
        if (!state.storyboardState) {
          throw new Error("Missing storyboard state");
        }

        const scene = state.storyboardState.scenes[ state.currentSceneIndex ];
        console.log(
          `\n[process scene]: Processing Scene ${scene.id}/${state.storyboardState.scenes.length}`
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

        // Implicitly check for the best/latest video path
        const sceneVideoPath = await this.storageManager.getGcsObjectPath({ type: "scene_video", sceneId: scene.id, attempt: 'latest' });
        const shouldForceRegenerate = state.forceRegenerateSceneId === scene.id;

        if (!shouldForceRegenerate && await this.storageManager.fileExists(sceneVideoPath)) {
          console.log(`   ... Scene video already exists at ${sceneVideoPath}, skipping.`);

          await this.publishEvent({
            type: "SCENE_SKIPPED",
            projectId: this.videoId,
            payload: {
              sceneId: scene.id,
              reason: "Video already exists",
              videoUrl: this.storageManager.buildObjectData(sceneVideoPath, "").publicUri,
            },
            timestamp: new Date().toISOString(),
          });

          const generatedScene = {
            ...scene,
            generatedVideo: this.storageManager.buildObjectData(sceneVideoPath, ""),
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
            const nextScenePath = await this.storageManager.getGcsObjectPath({ type: "scene_video", sceneId: nextSceneId, attempt: 'latest' });
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
            __interrupt__: undefined,
            __interrupt_resolved__: false,
            attempts: {
              ...state.attempts,
              [ nodeName ]: 0
            }
          };
          await this.saveStateToStorage(newState);
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

        const onProgress = async (sceneId: number, msg: string, artifacts?: { generatedVideo: ObjectData; }) => {
          await this.publishEvent({
            type: "SCENE_PROGRESS",
            projectId: this.videoId,
            payload: { sceneId, progressMessage: msg, ...artifacts },
            timestamp: new Date().toISOString(),
          });
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
          onAttemptComplete,
          onProgress,
          state.generationRules
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
          bestAttempt: result.usedAttempt, // Correctly track the used (best) attempt number
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

          // Register best attempt with storage manager
          this.storageManager.registerBestAttempt('scene_video', scene.id, result.usedAttempt);
          this.storageManager.registerBestAttempt('scene_start_frame', scene.id, result.usedAttempt);
          this.storageManager.registerBestAttempt('scene_end_frame', scene.id, result.usedAttempt);
        }

        // Ensure updated storyboard state carries the best attempt info
        if (updatedStoryboardState.scenes[ state.currentSceneIndex ]) {
          updatedStoryboardState.scenes[ state.currentSceneIndex ].bestAttempt = result.usedAttempt;
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
          attempts: {
            ...newAttempts,
            [ nodeName ]: 0 // Reset node attempt on success
          }
        };

        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "process_scene");
        return newState;
      } catch (error) {
        console.error(`[${nodeName}] Error on attempt ${currentAttempt}:`, error);

        const sceneId = state.storyboardState?.scenes[ state.currentSceneIndex ]?.id;

        const errorMessage = extractErrorMessage(error);
        const errorDetails = extractErrorDetails(error);

        const interruptValue: LlmRetryInterruptValue = {
          type: currentAttempt >= maxRetries ? 'llm_retry_exhausted' : 'llm_intervention',
          error: errorMessage,
          errorDetails: errorDetails,
          functionName: 'process_scene',
          nodeName: nodeName,
          params: {
            sceneId: sceneId,
            sceneIndex: state.currentSceneIndex,
            promptModification: sceneId ? state.scenePromptOverrides?.[ sceneId ] : undefined
          },
          attemptCount: currentAttempt,
          lastAttemptTimestamp: new Date().toISOString(),
          stackTrace: error instanceof Error ? error.stack : undefined
        };

        throw new NodeInterrupt(interruptValue);
      }
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

        await this.saveStateToStorage(newState);
        await this.publishStateUpdate(newState, "render_video");
        return newState;
      } catch (error) {
        console.error("   Failed to render video:", error);

        const newState = {
          ...state,
          errors: [ ...state.errors, {
            node: 'render_video',
            error: `Video rendering failed: ${error}`,
            skipped: true,
            timestamp: new Date().toISOString(),
          } ]
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

      await this.saveStateToStorage(state);
      await this.publishStateUpdate(state, "finalize");

      return state;
    });

    workflow.addEdge("semantic_analysis" as any, "generate_character_assets" as any);
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
    // await this.storageManager.initialize(); // Initialization moved to sync_state node

    let initialState: InitialGraphState;
    const hasAudio = !!localAudioPath;
    let audioGcsUri: string | undefined;
    let audioPublicUri: string | undefined;

    if (hasAudio && localAudioPath) {
      console.log("   Checking for existing audio file...");
      audioGcsUri = await this.storageManager.uploadAudioFile(localAudioPath);
      audioPublicUri = audioGcsUri ? this.storageManager.getPublicUrl(audioGcsUri) : undefined;

    } else {
      console.log("   No audio file provided - generating video from creative prompt only.");
    }

    const checkpointerManager = new CheckpointerManager(postgresUrl);
    await checkpointerManager.init();

    let checkpointer = checkpointerManager.getCheckpointer();
    if (checkpointer) {
      console.log("   Persistence enabled via Checkpointer. Checking for existing state.");

      const config: RunnableConfig = {
        configurable: { thread_id: this.videoId },
      };
      const existingCheckpoint = await checkpointerManager.loadCheckpoint(config);

      if (existingCheckpoint) {
        console.log("   Found existing checkpoint in Postgres.");
        initialState = {
          errors: [],
          generationRules: [],
          refinedRules: [],
          ...existingCheckpoint.channel_values,
          attempts: await this.storageManager.scanCurrentAttempts(),
          localAudioPath,
          hasAudio,
          audioGcsUri,
          audioPublicUri,
          currentSceneIndex: 0,
          creativePrompt,
        };
      } else {
        console.log("   No checkpoint found in Postgres. Checking GCS for persistent state.");
        try {
          const statePath = await this.storageManager.getGcsObjectPath({ type: "state" });
          const savedState = await this.storageManager.downloadJSON<GraphState>(statePath);
          console.log("   Found state.json in GCS. Resuming from backup.");
          initialState = {
            ...savedState,
            // Ensure runtime arguments override saved state where appropriate
            localAudioPath: localAudioPath || savedState.localAudioPath,
            hasAudio,
            audioGcsUri: audioGcsUri || savedState.audioGcsUri,
            audioPublicUri: audioPublicUri || savedState.audioPublicUri,
            creativePrompt: creativePrompt || savedState.creativePrompt,
            attempts: await this.storageManager.scanCurrentAttempts(),
          };
        } catch (error) {
          console.log("   No state.json found. Checking for storyboard.json...");
          try {
            const storyboardPath = await this.storageManager.getGcsObjectPath({ type: "storyboard" });
            const storyboard = await this.storageManager.downloadJSON<Storyboard>(storyboardPath);
            console.log("   Found existing storyboard. Resuming workflow.");

            initialState = {
              localAudioPath,
              creativePrompt,
              hasAudio,
              audioGcsUri,
              audioPublicUri,
              storyboard,
              storyboardState: storyboard,
              currentSceneIndex: 0,
              errors: [],
              generationRules: [],
              refinedRules: [],
              attempts: await this.storageManager.scanCurrentAttempts(),
            };
          } catch (err) {
            console.error("Error loading from GCS: ", err);
            console.log("   No existing storyboard found. Starting fresh workflow.");
            if (!creativePrompt) {
              throw new Error("Cannot start new workflow without creativePrompt.");
            }

            initialState = {
              localAudioPath,
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
      }
    } else {
      console.log("   No checkpointer found. Checking GCS for existing storyboard.");
      try {
        console.log("   Checking for existing storyboard...");
        const storyboardPath = await this.storageManager.getGcsObjectPath({ type: "storyboard" });
        const storyboard = await this.storageManager.downloadJSON<Storyboard>(storyboardPath);
        console.log("   Found existing storyboard. Resuming workflow.");

        initialState = {
          localAudioPath,
          creativePrompt,
          hasAudio,
          audioGcsUri,
          audioPublicUri,
          storyboard,
          storyboardState: storyboard,
          currentSceneIndex: 0,
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
          localAudioPath,
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
      signal: this.controller?.signal,
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

  const controller = new AbortController();

  process.on("SIGINT", async () => {
    console.log("Shutting down workflow...");
    controller.abort();
    try {
      console.log("Aborted controller. Waiting for cleanup...");
    } catch (e) {
      console.error("Error during abort sequence", e);
    }
    // Allow some time for cleanup, then force exit
    setTimeout(() => {
      console.log("Forcing exit...");
      process.exit(1);
    }, 5000);
  });

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

  const workflow = new CinematicVideoWorkflow(projectId, videoId, bucketName, controller);

  const creativePrompt = argv.prompt || defaultCreativePrompt;

  try {
    const result = await workflow.execute(audioPath, creativePrompt, postgresUrl);
    console.log("\n" + "=".repeat(60));
    console.log("✅ Workflow completed successfully!");
    console.log(`   Generated ${result.storyboardState.scenes.length} scenes`);
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
