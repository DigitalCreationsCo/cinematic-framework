// ============================================================================
// OPTIMIZED COMPOSITIONAL AGENT
// ============================================================================

import {
  Scene,
  Storyboard,
  StoryboardSchema,
  zodToJSONSchema,
  InitialContextSchema,
  SceneBatchSchema
} from "../../shared/pipeline-types";
import { cleanJsonOutput } from "../utils";
import { GCPStorageManager } from "../storage-manager";
import { composeStoryboardEnrichmentPrompt } from "../prompts/prompt-composer";
import { buildDirectorVisionPrompt } from "../prompts/role-director";
import { retryLlmCall, RetryConfig } from "../lib/llm-retry";
import { LlmController } from "../llm/controller";
import { buildllmParams } from "../llm/google/llm-params";
import { imageModelName, textModelName, videoModelName } from "../llm/google/models";

export class CompositionalAgent {
  private llm: LlmController;
  private storageManager: GCPStorageManager;
  private options?: { signal?: AbortSignal; };

  constructor(llm: LlmController, storageManager: GCPStorageManager, options?: { signal?: AbortSignal; }) {
    this.llm = llm;
    this.storageManager = storageManager;
    this.options = options;
  }

  async generateFullStoryboard(storyboard: Storyboard, creativePrompt: string, retryConfig?: RetryConfig): Promise<Storyboard> {
    console.log("   ... Enriching storyboard with a two-pass approach...");

    const initialContext = await this._generateInitialStoryboardContext(creativePrompt, storyboard.scenes, retryConfig);
    console.log("Initial Context:", JSON.stringify(initialContext, null, 2));

    const BATCH_SIZE = 10;
    let enrichedScenes: Scene[] = [];

    for (let i = 0; i < storyboard.scenes.length; i += BATCH_SIZE) {
      const chunkScenes = storyboard.scenes.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(storyboard.scenes.length / BATCH_SIZE);
      console.log(`   ... Processing scene batch ${batchNum}/${totalBatches} (${chunkScenes.length} scenes)...`);

      const systemPrompt = composeStoryboardEnrichmentPrompt(
        creativePrompt,
        initialContext.characters,
        initialContext.locations,
        zodToJSONSchema(SceneBatchSchema)
      );

      let context = `CURRENT BATCH (${batchNum}/${totalBatches}):\n`;
      if (enrichedScenes.length > 0) {
        const lastScene = enrichedScenes[ enrichedScenes.length - 1 ];
        context += `PREVIOUS SCENE (for continuity):\n${JSON.stringify(lastScene, null, 2)}\n\n`;
      }
      context += `SCENES TO ENRICH:\n${JSON.stringify(chunkScenes, null, 2)}`;

      const llmCall = async () => {
        const response = await this.llm.generateContent(buildllmParams({
          contents: [
            { role: 'user', parts: [ { text: systemPrompt } ] },
            { role: 'user', parts: [ { text: context } ] }
          ],
          config: {
            abortSignal: this.options?.signal,
            responseJsonSchema: zodToJSONSchema(SceneBatchSchema),
          }
        }));
        const content = response.text;
        if (!content) throw new Error("No content generated from LLM");

        const cleanedContent = cleanJsonOutput(content);
        return JSON.parse(cleanedContent);
      };

      const batchResult = await retryLlmCall(llmCall, undefined, retryConfig);
      enrichedScenes.push(...batchResult.scenes);
    }

    const updatedStoryboard: Storyboard = {
      ...initialContext,
      scenes: enrichedScenes.map((s, i) => ({ ...s, id: i })), // Ensure sequential IDs
      metadata: {
        ...initialContext.metadata,
        totalScenes: storyboard.scenes.length,
        duration: storyboard.scenes.length > 0 ? storyboard.scenes[ storyboard.scenes.length - 1 ].endTime : 0,
        creativePrompt: creativePrompt,
        videoModel: (storyboard.metadata as any).videoModel || videoModelName,
        imageModel: (storyboard.metadata as any).imageModel || imageModelName,
        textModel: (storyboard.metadata as any).textModel || textModelName,
      } as Storyboard[ 'metadata' ]
    };

    this.validateTimingPreservation(storyboard.scenes, updatedStoryboard.scenes);

    const storyboardPath = this.storageManager.getGcsObjectPath({ type: "storyboard" });
    await this.storageManager.uploadJSON(updatedStoryboard, storyboardPath);

    console.log(`✓ Storyboard enriched successfully:`);
    console.log(`  - Title: ${updatedStoryboard.metadata.title || "Untitled"}`);
    console.log(`  - Duration: ${updatedStoryboard.metadata.duration}`);
    console.log(`  - Total Scenes: ${updatedStoryboard.metadata.totalScenes}`);
    console.log(`  - Characters: ${updatedStoryboard.characters.length}`);
    console.log(`  - Locations: ${updatedStoryboard.locations.length}`);
    console.log(`  - Creative prompt added to metadata: ${((updatedStoryboard.metadata as any).creativePrompt as string).slice(0, 50)}...`);

    return updatedStoryboard;
  }

  private async _generateInitialStoryboardContext(creativePrompt: string, scenes: Scene[], retryConfig?: RetryConfig): Promise<Storyboard> {
    console.log("   ... Generating initial context (metadata, characters, locations)...");

    // Use Director's vision prompt for initial context
    const audioSegments = scenes.map(s => ({
      startTime: s.startTime,
      endTime: s.endTime,
      duration: s.duration,
      type: s.type || "lyrical",
      mood: s.mood,
      intensity: s.intensity || "medium",
      tempo: s.tempo || "moderate",
      lyrics: s.lyrics || "",
      musicalDescription: s.musicalDescription || "",
      musicChange: s.musicChange || "",
      transitionType: s.transitionType || "smooth"
    }));

    const totalDuration = scenes.length > 0 ? scenes[ scenes.length - 1 ].endTime : 0;

    const jsonSchema = zodToJSONSchema(InitialContextSchema);
    const systemPrompt = buildDirectorVisionPrompt(creativePrompt, jsonSchema, audioSegments, totalDuration);

    const context = `
      Generate the initial storyboard context including:
      - Metadata (title, style, emotional arc)
      - Characters (all entities in the story with complete specifications)
      - Locations (all settings with atmospheric details)

      The scene-by-scene breakdown will be handled in a second pass.
    `;

    const llmCall = async () => {
      const response = await this.llm.generateContent(buildllmParams({
        contents: [
          { role: 'user', parts: [ { text: systemPrompt } ] },
          { role: 'user', parts: [ { text: context } ] }
        ],
        config: {
          abortSignal: this.options?.signal,
          responseJsonSchema: jsonSchema,
        }
      }));
      const content = response.text;
      if (!content) throw new Error("No content generated from LLM for initial context");

      const cleanedContent = cleanJsonOutput(content);
      const parsedContext = JSON.parse(cleanedContent);

      if (!parsedContext.metadata) {
        throw new Error("Failed to generate metadata in initial context");
      }

      return {
        ...parsedContext,
        scenes: [] // Scenes will be populated in the second pass
      };
    };

    return retryLlmCall(llmCall, undefined, retryConfig);
  }

  private validateTimingPreservation(originalScenes: Scene[], enrichedScenes: Scene[]): void {
    if (originalScenes.length !== enrichedScenes.length) {
      console.warn(`⚠️ Scene count mismatch: original=${originalScenes.length}, enriched=${enrichedScenes.length}`);
    }

    for (let i = 0; i < Math.min(originalScenes.length, enrichedScenes.length); i++) {
      const orig = originalScenes[ i ];
      const enrich = enrichedScenes[ i ];

      if (orig.startTime !== enrich.startTime || orig.endTime !== enrich.endTime) {
        console.warn(`⚠️ Timing mismatch in scene ${i + 1}: original=[${orig.startTime}-${orig.endTime}], enriched=[${enrich.startTime}-${enrich.endTime}]`);
      }

      if (orig.duration !== enrich.duration) {
        console.warn(`⚠️ Duration mismatch in scene ${i + 1}: original=${orig.duration}s, enriched=${enrich.duration}s`);
      }
    }
  }

  async expandCreativePrompt(
    userPrompt: string,
  ): Promise<string> {

    const systemPrompt = buildDirectorVisionPrompt(userPrompt);

    const llmCall = async () => {
      const params = buildllmParams({
        contents: [
          { role: "user", parts: [ { text: systemPrompt } ] },
        ],
        config: {
          abortSignal: this.options?.signal,
          temperature: 0.9,
        }
      });

      const response = await this.llm.generateContent(params);

      const expandedPrompt = response.text;

      if (!expandedPrompt || expandedPrompt.trim().length === 0) {
        throw new Error("No content generated from LLM for prompt expansion");
      }

      console.log(`✓ Creative prompt expanded: ${userPrompt.substring(0, 50)}... → ${expandedPrompt.length} chars`);

      return expandedPrompt;
    };

    return await retryLlmCall(llmCall, undefined, { maxRetries: 3, initialDelay: 1000 });
  }

  /**
   * Generates a storyboard from creative prompt without audio timing constraints.
   * Used when no audio file is provided.
   */
  async generateStoryboardFromPrompt(creativePrompt: string, retryConfig?: RetryConfig): Promise<Storyboard> {
    console.log("   ... Generating full storyboard from creative prompt (no audio)...");

    const jsonSchema = zodToJSONSchema(StoryboardSchema);

    const systemPrompt = buildDirectorVisionPrompt(creativePrompt, jsonSchema);

    const llmCall = async () => {
      const response = await this.llm.generateContent(buildllmParams({
        contents: [
          { role: 'user', parts: [ { text: systemPrompt } ] },
        ],
        config: {
          abortSignal: this.options?.signal,
          responseJsonSchema: jsonSchema,
          temperature: 0.8,
        }
      }));

      const content = response.text;
      if (!content) throw new Error("No content generated from LLM");

      const cleanedContent = cleanJsonOutput(content);
      const storyboard: Storyboard = JSON.parse(cleanedContent);

      // Ensure sequential IDs
      storyboard.scenes = storyboard.scenes.map((s, i) => ({ ...s, id: i }));

      // Validate that all scenes have valid durations
      for (const scene of storyboard.scenes) {
        if (scene.duration !== 4 && scene.duration !== 6 && scene.duration !== 8) {
          throw new Error(`Invalid scene duration: ${scene.duration}s. Must be 4, 6, or 8 seconds.`);
        }
      }

      return storyboard;
    };

    const storyboard = await retryLlmCall(llmCall, undefined, { maxRetries: 3, initialDelay: 1000, ...retryConfig });
    storyboard.metadata.creativePrompt = creativePrompt;
    storyboard.metadata.videoModel = videoModelName;
    storyboard.metadata.imageModel = imageModelName;
    storyboard.metadata.textModel = textModelName;

    // Save storyboard
    const storyboardPath = this.storageManager.getGcsObjectPath({ type: "storyboard" });
    await this.storageManager.uploadJSON(storyboard, storyboardPath);

    console.log(`✓ Storyboard generated successfully:`);
    console.log(`  - Title: ${storyboard.metadata.title || "Untitled"}`);
    console.log(`  - Duration: ${storyboard.metadata.duration}s`);
    console.log(`  - Total Scenes: ${storyboard.metadata.totalScenes}`);
    console.log(`  - Characters: ${storyboard.characters.length}`);
    console.log(`  - Locations: ${storyboard.locations.length}`);
    console.log(`  - Creative prompt added to metadata: ${((storyboard.metadata as any).creativePrompt as string).slice(0, 50)}...`);

    return storyboard;
  }
}
