import {
  Scene,
  Storyboard,
  InitialStoryboardContext,
  SceneBatch,
  Location,
  StoryboardAttributes,
  SceneAttributes
} from "../../shared/types/workflow.types";
import { cleanJsonOutput, deleteBogusUrlsStoryboard, getJSONSchema } from "../../shared/utils/utils";
import { GCPStorageManager } from "../storage-manager";
import { composeFrameGenerationPromptMeta, composeStoryboardEnrichmentPrompt } from "../prompts/prompt-composer";
import { buildDirectorVisionPrompt } from "../prompts/role-director";
import { retryLlmCall, RetryConfig } from "../../shared/utils/llm-retry";
import { TextModelController } from "../llm/text-model-controller";
import { buildllmParams } from "../llm/google/google-llm-params";
import { imageModelName, qualityCheckModelName, textModelName, videoModelName } from "../llm/google/models";
import { ThinkingLevel } from "@google/genai";
import { AssetVersionManager } from "../asset-version-manager";
import { SaveAssetsCallback } from "@shared/types/pipeline.types";
import { GenerativeResultEnhanceStoryboard, GenerativeResultEnvelope, GenerativeResultExpandCreativePrompt, GenerativeResultGenerateStoryboard, JobRecordExpandCreativePrompt, JobRecordGenerateStoryboard } from "@shared/types/job.types";



// ============================================================================
// COMPOSITIONAL AGENT
// ============================================================================

export class CompositionalAgent {
  private llm: TextModelController;
  private storageManager: GCPStorageManager;
  private assetManager: AssetVersionManager;
  private options?: { signal?: AbortSignal; };

  constructor(
    llm: TextModelController,
    storageManager: GCPStorageManager,
    assetManager: AssetVersionManager,
    options?: { signal?: AbortSignal; }
  ) {
    this.llm = llm;
    this.storageManager = storageManager;
    this.assetManager = assetManager;
    this.options = options;
  }

  async generateFullStoryboard(
    storyboard: Storyboard, enhancedPrompt: string, retryConfig: RetryConfig, saveAssets: SaveAssetsCallback
  ): Promise<GenerativeResultEnhanceStoryboard> {
    console.log("   ... Enriching storyboard with a two-pass approach...");

    const { data: { storyboard: initialContext } } = await this._generateInitialStoryboardContext(storyboard.metadata.title, enhancedPrompt, storyboard.scenes, retryConfig);
    console.log("Initial Context:", JSON.stringify(initialContext, null, 2));

    const BATCH_SIZE = 10;
    let enrichedScenes: SceneAttributes[] = [];

    for (let i = 0; i < initialContext.scenes.length; i += BATCH_SIZE) {
      const chunkScenes = initialContext.scenes.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(initialContext.scenes.length / BATCH_SIZE);
      console.log(`   ... Processing scene batch ${batchNum}/${totalBatches} (${chunkScenes.length} scenes)...`);

      const systemPrompt = composeStoryboardEnrichmentPrompt(
        enhancedPrompt,
        initialContext.characters,
        initialContext.locations,
        JSON.stringify(getJSONSchema(SceneBatch))
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
            responseJsonSchema: getJSONSchema(SceneBatch),
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.HIGH
            }
          }
        }));
        const content = response.text;
        if (!content) throw new Error("No content generated from LLM");

        const cleanedContent = cleanJsonOutput(content);
        return JSON.parse(cleanedContent) as SceneBatch;
      };

      const batchResult = await retryLlmCall(llmCall, undefined, retryConfig);
      enrichedScenes.push(...batchResult.scenes); 
    }

    const updatedStoryboard = Storyboard.parse(deleteBogusUrlsStoryboard({
      ...initialContext,
      scenes: enrichedScenes.map((s, i) => ({ ...s, sceneIndex: i })),
      metadata: {
        ...initialContext.metadata,
        totalScenes: enrichedScenes.length,
        duration: enrichedScenes.length > 0 ? enrichedScenes[ enrichedScenes.length - 1 ].endTime : 0,
        enhancedPrompt: enhancedPrompt,
      }
    }));
    this.validateTimingPreservation(storyboard.scenes, updatedStoryboard.scenes);

    saveAssets(
      { projectId: updatedStoryboard.metadata.projectId },
      'storyboard',
      'text',
      [ JSON.stringify(updatedStoryboard) ],
      { model: textModelName }
    );

    console.log(`✓ Storyboard enriched successfully:`);
    console.log(`  - Title: ${updatedStoryboard.metadata.title || "Untitled"}`);
    console.log(`  - Duration: ${updatedStoryboard.metadata.duration}`);
    console.log(`  - Total Scenes: ${updatedStoryboard.metadata.totalScenes}`);
    console.log(`  - Characters: ${updatedStoryboard.characters.length}`);
    console.log(`  - Locations: ${updatedStoryboard.locations.length}`);
    console.log(`  - Creative prompt added to metadata: ${updatedStoryboard.metadata.enhancedPrompt.slice(0, 50)}...`);

    return { data: { storyboard: updatedStoryboard }, metadata: { model: textModelName, attempts: 1, acceptedAttempt: 1 } };
  }

  private async _generateInitialStoryboardContext(
    title: string, enhancedPrompt: string, scenes: Scene[], retryConfig: RetryConfig
  ): Promise<GenerativeResultEnhanceStoryboard> {
    console.log("   ... Generating initial context (metadata, characters, locations)...");

    const totalDuration = scenes.length > 0 ? scenes[ scenes.length - 1 ].endTime : 0;

    const systemPrompt = buildDirectorVisionPrompt(title, enhancedPrompt, JSON.stringify(getJSONSchema(InitialStoryboardContext)), scenes, totalDuration);

    const context = `
      Generate the initial storyboard context including:

      ### Metadata
      ${JSON.stringify(getJSONSchema(InitialStoryboardContext.shape.metadata))}

      ### Characters
      ${JSON.stringify(getJSONSchema(InitialStoryboardContext.shape.characters))}

      ### Locations
      ${JSON.stringify(getJSONSchema(InitialStoryboardContext.shape.locations))}

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
          responseJsonSchema: getJSONSchema(InitialStoryboardContext),
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH
          }
        }
      }));
      const content = response.text;
      if (!content) throw new Error("No content generated from LLM for initial context");

      const cleanedContent = cleanJsonOutput(content);
      const parsedContext = JSON.parse(cleanedContent) as Storyboard;

      if (!parsedContext.metadata) {
        throw new Error("Failed to generate metadata in initial context");
      }

      return {
        ...parsedContext,
        scenes: [] // Scenes will be populated in the next pass
      } as Storyboard;
    };

    const storyboard = await retryLlmCall(llmCall, undefined, retryConfig);
    return { data: { storyboard }, metadata: { model: textModelName, attempts: 1, acceptedAttempt: 1 } };
  }

  private validateTimingPreservation(originalScenes: SceneAttributes[], enrichedScenes: SceneAttributes[]): void {
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
    title: string,
    userPrompt: string,
    retryConfig: RetryConfig,
  ): Promise<GenerativeResultExpandCreativePrompt> {

    const systemPrompt = buildDirectorVisionPrompt(title, userPrompt);

    const llmCall = async () => {
      const params = buildllmParams({
        contents: [
          { role: "user", parts: [ { text: systemPrompt } ] },
        ],
        config: {
          abortSignal: this.options?.signal,
          temperature: 0.9,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH
          }
        }
      });

      const response = await this.llm.generateContent(params);

      const expandedPrompt = response.text;

      if (!expandedPrompt || expandedPrompt.trim().length === 0) {
        throw new Error("No content generated from LLM for prompt expansion");
      }

      console.log(` Prompt expanded: ${userPrompt.substring(0, 10)}... → ${expandedPrompt.length} chars`);

      return expandedPrompt as string;
    };

    const expandedPrompt = await retryLlmCall(llmCall, undefined, retryConfig);
    console.log(` Expanded prompt: ${userPrompt.length} to ${expandedPrompt.length} characters.`);

    return { data: { expandedPrompt }, metadata: { model: textModelName, attempts: 1, acceptedAttempt: 1 } };
  }

  /**
   * Generates a storyboard from creative prompt without audio timing constraints.
   * Used when no audio file is provided.
   */
  async generateStoryboardExclusivelyFromPrompt(
    title: string, enhancedPrompt: string, retryConfig: RetryConfig
  ): Promise<GenerativeResultGenerateStoryboard> {
    console.log("   ... Generating full storyboard from creative prompt (no audio)...");

    const systemPrompt = buildDirectorVisionPrompt(title, enhancedPrompt, JSON.stringify(getJSONSchema(StoryboardAttributes)));

    const llmCall = async () => {
      const response = await this.llm.generateContent(buildllmParams({
        contents: [
          { role: 'user', parts: [ { text: systemPrompt } ] },
        ],
        config: {
          abortSignal: this.options?.signal,
          responseJsonSchema: getJSONSchema(StoryboardAttributes),
          temperature: 0.8,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH
          }
        }
      }));

      const content = response.text;
      if (!content) throw new Error("No content generated from LLM");

      const cleanedContent = cleanJsonOutput(content);
      const storyboard: StoryboardAttributes = JSON.parse(cleanedContent);
      storyboard.scenes = storyboard.scenes.map((s, i) => ({ ...s, sceneIndex: i }));
      for (const scene of storyboard.scenes) {
        if (scene.duration !== 4 && scene.duration !== 6 && scene.duration !== 8) {
          throw new Error(`Invalid scene duration: ${scene.duration}s. Must be 4, 6, or 8 seconds.`);
        }
      }

      return deleteBogusUrlsStoryboard(storyboard);
    };

    const storyboard = await retryLlmCall(llmCall, undefined, { initialDelay: 1000, ...retryConfig, maxRetries: 3 });

    console.log(`✓ Storyboard generated successfully:`);
    console.log(`  - Title: ${storyboard.metadata.title || "Untitled"}`);
    console.log(`  - Duration: ${storyboard.metadata.duration}s`);
    console.log(`  - Total Scenes: ${storyboard.metadata.totalScenes}`);
    console.log(`  - Characters: ${storyboard.characters.length}`);
    console.log(`  - Locations: ${storyboard.locations.length}`);
    console.log(`  - Creative prompt added to metadata: ${((storyboard.metadata as any).enhancedPrompt as string).slice(0, 50)}...`);

    return { data: { storyboard }, metadata: { model: textModelName, attempts: 1, acceptedAttempt: 1 } };
  }
}
