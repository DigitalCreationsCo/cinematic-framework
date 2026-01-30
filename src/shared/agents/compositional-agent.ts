import {
  InitialStoryboardContext,
  SceneBatch,
  StoryboardAttributes,
  SceneAttributes,
  isValidDuration,
  AudioAnalysisAttributes
} from "../types/index.js";
import { cleanJsonOutput, deleteBogusUrlsStoryboard, getJSONSchema, roundToValidDuration } from "../utils/utils.js";
import { GCPStorageManager } from "../services/storage-manager.js";
import { composeFrameGenerationPromptMeta, composeStoryboardEnrichmentPrompt } from "../prompts/prompt-composer.js";
import { buildDirectorVisionPrompt } from "../prompts/role-director.js";
import { retryLlmCall, RetryConfig } from "../utils/llm-retry.js";
import { TextModelController } from "../llm/text-model-controller.js";
import { buildllmParams } from "../llm/google/google-llm-params.js";
import { imageModelName, qualityCheckModelName, textModelName, videoModelName } from "../llm/google/models.js";
import { ThinkingLevel } from "@google/genai";
import { AssetVersionManager } from "../services/asset-version-manager.js";
import { SaveAssetsCallback } from "../types/pipeline.types.js";
import { GenerativeResultEnhanceStoryboard, GenerativeResultEnvelope, GenerativeResultExpandCreativePrompt, GenerativeResultGenerateStoryboard, JobRecordExpandCreativePrompt, JobRecordGenerateStoryboard } from "../types/job.types.js";



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
    title: string, enhancedPrompt: string, scenes: (StoryboardAttributes[ 'scenes' ] | AudioAnalysisAttributes[ 'segments' ]), retryConfig: RetryConfig, saveAssets: SaveAssetsCallback
  ): Promise<GenerativeResultEnhanceStoryboard> {
    
    const { data: initialContext } = await this._generateInitialStoryboardContext(title, enhancedPrompt, scenes, retryConfig);
    
    console.log("Enriching storyboard with a two-pass approach");
    console.log("Initial Context:", JSON.stringify(initialContext).slice(0, 50));

    const BATCH_SIZE = 10;
    let enrichedScenes: SceneAttributes[] = [];

    for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
      const chunkScenes = scenes.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(scenes.length / BATCH_SIZE);
      console.log({ batchNum, totalBatches, numScenes: chunkScenes.length }, `Processing scene batch ${batchNum}/${totalBatches}`);

      const systemPrompt = composeStoryboardEnrichmentPrompt(
        enhancedPrompt,
        initialContext.characters,
        initialContext.locations,
        JSON.stringify(getJSONSchema(SceneBatch))
      );

      let context = `CURRENT BATCH (${batchNum}/${totalBatches}):\n`;
      if (enrichedScenes.length > 0) {
        context += `NARRATIVE EXPOSITION: ${JSON.stringify(scenes[0])}\n\n`;
        const lastScene = enrichedScenes[ enrichedScenes.length - 1 ];
        context += `PREVIOUS SCENE (for continuity):\n${JSON.stringify(lastScene)}\n\n`;
      }
      context += `SCENES TO ENRICH:\n${JSON.stringify(chunkScenes)}`;

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

    const updatedStoryboard: StoryboardAttributes = {
      ...initialContext,
      scenes: enrichedScenes.map((s, i) => ({ ...s, sceneIndex: i })),
      metadata: {
        ...initialContext.metadata,
        totalScenes: enrichedScenes.length,
        duration: enrichedScenes.length > 0 ? enrichedScenes[ enrichedScenes.length - 1 ].endTime : 0,
        enhancedPrompt: enhancedPrompt,
      }
    };
    deleteBogusUrlsStoryboard(updatedStoryboard);
    this.validateTimingPreservation(scenes, updatedStoryboard.scenes);

    console.log(`✓ Storyboard enriched successfully:`);
    console.log(`  - Title: ${updatedStoryboard.metadata.title || "Untitled"}`);
    console.log(`  - Duration: ${updatedStoryboard.metadata.duration}`);
    console.log(`  - Total Scenes: ${updatedStoryboard.metadata.totalScenes}`);
    console.log(`  - Characters: ${updatedStoryboard.characters.length}`);
    console.log(`  - Locations: ${updatedStoryboard.locations.length}`);
    console.log(`  - Creative prompt added to metadata: ${updatedStoryboard.metadata.enhancedPrompt.slice(0, 50)}...`);

    return { data: { storyboardAttributes: updatedStoryboard }, metadata: { model: textModelName, attempts: 1, acceptedAttempt: 1 } };
  }

  private async _generateInitialStoryboardContext(
    title: string, enhancedPrompt: string, scenes: (SceneAttributes[] | AudioAnalysisAttributes[ 'segments' ]), retryConfig: RetryConfig
  ): Promise<GenerativeResultEnvelope<InitialStoryboardContext>> {
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
      const parsedContext: InitialStoryboardContext = JSON.parse(cleanedContent);

      if (!parsedContext.metadata) {
        throw new Error("Failed to generate metadata in initial context");
      }

      return parsedContext;
    };

    const intialContext = await retryLlmCall(llmCall, undefined, retryConfig);
    return { data: intialContext, metadata: { model: textModelName, attempts: 1, acceptedAttempt: 1 } };
  }

  private validateTimingPreservation(originalScenes: AudioAnalysisAttributes[ 'segments' ], enrichedScenes: SceneAttributes[]): void {
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
        if (!isValidDuration(scene.duration)) {
          console.debug('Rounding scene duration from ', scene.duration, ' to ', roundToValidDuration(scene.duration));
          scene.duration = roundToValidDuration(scene.duration);
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

    return { data: { storyboardAttributes: storyboard }, metadata: { model: textModelName, attempts: 1, acceptedAttempt: 1 } };
  }
}
