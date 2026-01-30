import { FileData, Modality, Part, ThinkingLevel } from "@google/genai";
import { GCPStorageManager, GcsObjectPathParams } from "../services/storage-manager.js";
import { TextModelController } from "../llm/text-model-controller.js";
import { buildllmParams } from "../llm/google/google-llm-params.js";
import { imageModelName, qualityCheckModelName, textModelName } from "../llm/google/models.js";
import { QualityCheckAgent } from "./quality-check-agent.js";
import { Character, Location, QualityEvaluationResult, Scene } from "../types/index.js";
import { retryLlmCall } from "../utils/llm-retry.js";
import { RAIError } from "../utils/errors.js";
import { GraphInterrupt } from "@langchain/langgraph";
import { composeFrameGenerationPromptMeta, composeGenerationRules } from "../prompts/prompt-composer.js";
import { cleanJsonOutput } from "../utils/utils.js";
import { AssetVersionManager } from "../services/asset-version-manager.js";
import { QualityRetryHandler } from "../utils/quality-retry-handler.js";
import { OnAttemptCallback, SaveAssetsCallback, UpdateSceneCallback } from "../types/pipeline.types.js";
import { GenerativeResultEnvelope, GenerativeResultFrameRender, JobRecordFrameRender } from "../types/job.types.js";

type FrameImageObjectParams = Extract<GcsObjectPathParams, ({ type: "scene_start_frame"; } | { type: "scene_end_frame"; })>;

export class FrameCompositionAgent {
    private llm: TextModelController;
    private imageModel: TextModelController;
    private qualityAgent: QualityCheckAgent;
    private assetManager: AssetVersionManager;
    private storageManager: GCPStorageManager;
    private options?: { signal?: AbortSignal; };

    constructor(
        llm: TextModelController,
        imageModel: TextModelController,
        qualityAgent: QualityCheckAgent,
        storageManager: GCPStorageManager,
        assetManager: AssetVersionManager,
        options?: { signal?: AbortSignal; }
    ) {
        this.llm = llm;
        this.imageModel = imageModel;
        this.qualityAgent = qualityAgent;
        this.storageManager = storageManager;
        this.assetManager = assetManager;
        this.options = options;
    }

    async prepareImageInputs(urls: string[]): Promise<FileData[]> {
        return Promise.all(
            urls.map(async (u) => {
                const mimeType = await this.storageManager.getObjectMimeType(u);
                if (!mimeType) {
                    throw new Error(`Could not determine mime type for ${u}`);
                }
                const fileParts = u.split('/');
                const displayName = fileParts[ fileParts.length - 1 ];
                return {
                    displayName,
                    mimeType,
                    fileUri: u,
                };
            })
        );
    }

    /**
     * Generate start or end frame image. Prompt, image, and evaluation assets are implicitly saved using handler.
     */
    async generateImage(
        scene: Scene,
        prompt: string,
        framePosition: "start" | "end",
        sceneCharacters: Character[],
        sceneLocations: Location[],
        previousFrame: string | undefined,
        referenceImages: string[],
        saveAssets: SaveAssetsCallback,
        updateScene: UpdateSceneCallback,
        onAttempt: OnAttemptCallback,
    ): Promise<GenerativeResultFrameRender> {
        if (!this.qualityAgent.qualityConfig.enabled && !!this.qualityAgent.evaluateFrameQuality) {
            const [ attempt ] = await this.assetManager.getNextVersionNumber(
                { projectId: scene.projectId, sceneId: scene.id },
                framePosition === "start" ? "scene_start_frame" : "scene_end_frame",
            );
            const imageWithoutQualityCheck = await this.executeGenerateImage(
                scene,
                prompt,
                framePosition,
                { type: framePosition === "start" ? "scene_start_frame" : "scene_end_frame", sceneId: scene.id, attempt },
                previousFrame,
                referenceImages,
                updateScene
            );

            const publicImageWithoutQualityCheck = this.storageManager.getPublicUrl(imageWithoutQualityCheck);

            saveAssets(
                { projectId: scene.projectId, sceneId: scene.id },
                framePosition === "start" ? "scene_start_frame" : "scene_end_frame",
                'image',
                [ publicImageWithoutQualityCheck ],
                {
                    model: imageModelName,
                    evaluation: null
                }
            );

            saveAssets(
                { projectId: scene.id, sceneId: scene.id },
                framePosition === "start" ? "start_frame_prompt" : "end_frame_prompt",
                'text',
                [ prompt ],
                { model: textModelName },
                true
            );

            return {
                data: { scene, image: imageWithoutQualityCheck },
                metadata: {
                    attempts: 1,
                    acceptedAttempt: 1,
                    model: imageModelName
                }
            };
        }

        const { data, metadata } = await this.generateImageWithQualityRetry(scene, prompt, framePosition, sceneCharacters, sceneLocations, previousFrame, referenceImages, saveAssets, updateScene, onAttempt);

        if (metadata.evaluation) {
            console.log(`   📊 Final: ${(metadata.evaluation.score * 100).toFixed(1)}% after ${metadata.attempts} attempt(s)`);
        }

        if (metadata.evaluation?.ruleSuggestion) {
            console.log(`\n📚 GENERATION RULE ADDED`);
            console.log(`   "${metadata.evaluation.ruleSuggestion}"`);
        }

        return { data: { ...data, scene }, metadata };
    }

    private async generateImageWithQualityRetry(
        scene: Scene,
        prompt: string,
        framePosition: "start" | "end",
        characters: Character[],
        locations: Location[],
        previousFrame: string | undefined,
        referenceImages: string[] = [],
        saveAssets: SaveAssetsCallback,
        updateScene: UpdateSceneCallback,
        onAttempt: OnAttemptCallback,
    ): Promise<GenerativeResultEnvelope<{ image: string; }>> {

        let image: string | null = null;
        let objectParams: FrameImageObjectParams;

        const acceptanceThreshold = this.qualityAgent.qualityConfig.minorIssueThreshold;
        let bestImage: string | null = null;
        let bestEvaluation: QualityEvaluationResult | null = null;
        let bestScore = 0;
        let numAttempts = 1;
        let totalAttempts = 0;
        let bestAttemptNumber = 0;
        const [ currentAttemptNumber ] = await this.assetManager.getNextVersionNumber(
            { projectId: scene.projectId, sceneId: scene.id },
            framePosition === "start" ? "scene_start_frame" : "scene_end_frame"
        );
        const prevAttempt = currentAttemptNumber - 1;

        for (let latestAttempt = prevAttempt + numAttempts; numAttempts <= this.qualityAgent.qualityConfig.maxRetries; numAttempts++) {

            totalAttempts = numAttempts;
            objectParams = { type: framePosition === "start" ? "scene_start_frame" : "scene_end_frame", sceneId: scene.id, attempt: currentAttemptNumber };
            let evaluation: QualityEvaluationResult | null = null;
            let score = 0;

            try {
                image = await this.generateImageWithSafetyRetry(
                    scene,
                    prompt,
                    framePosition,
                    objectParams,
                    currentAttemptNumber,
                    previousFrame,
                    referenceImages,
                    updateScene
                );

                console.log(`  🔍 Quality checking ${framePosition} frame for Scene ${scene.id}...`);

                scene.progressMessage = `Quality checking ${framePosition} frame...`;
                scene.status = "evaluating";
                updateScene(scene, false);

                evaluation = await this.qualityAgent.evaluateFrameQuality(
                    image,
                    scene,
                    framePosition,
                    characters,
                    locations,
                );

                const publicUrl = this.storageManager.getPublicUrl(image);
                saveAssets(
                    { projectId: scene.projectId, sceneId: scene.id },
                    framePosition === "start" ? "scene_start_frame" : "scene_end_frame",
                    'image',
                    [ publicUrl ],
                    {
                        model: imageModelName,
                        evaluation
                    }
                );
                saveAssets(
                    { projectId: scene.id, sceneId: scene.id },
                    framePosition === "start" ? "start_frame_prompt" : "end_frame_prompt",
                    'text',
                    [ prompt ],
                    { model: textModelName },
                    true
                );
                saveAssets(
                    { projectId: scene.projectId, sceneId: scene.id },
                    "frame_quality_evaluation",
                    'text',
                    [ JSON.stringify(evaluation) ],
                    {
                        model: qualityCheckModelName,
                    }
                );

                if (evaluation.score > bestScore) {
                    bestScore = score;
                    bestImage = image;
                    bestAttemptNumber = currentAttemptNumber;
                    bestEvaluation = evaluation;
                }
                this.qualityAgent[ "logAttemptResult" ](numAttempts, score, evaluation.grade);

                if (score >= acceptanceThreshold) {
                    console.log(`   ✅ Quality acceptable (${(score * 100).toFixed(1)}%)`);
                    return {
                        data: { image: bestImage! },
                        metadata: {
                            model: imageModelName,
                            attempts: totalAttempts,
                            acceptedAttempt: bestAttemptNumber,
                            evaluation
                        }
                    };
                }

                if (numAttempts >= this.qualityAgent.qualityConfig.maxRetries) {
                    break;
                }

                prompt = await this.qualityAgent.applyQualityCorrections(
                    prompt,
                    evaluation,
                    scene,
                    characters,
                    numAttempts
                );

                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (error) {
                if (error instanceof GraphInterrupt) throw Error;

                console.warn(`   ⚠️ Frame quality issues for ${this.storageManager.getObjectPath(objectParams)}`);
                if (evaluation && image) {
                    const score = this.qualityAgent[ "calculateOverallScore" ](evaluation.scores);
                    if (score > bestScore) {
                        bestScore = score;
                        bestImage = image;
                        bestEvaluation = evaluation;
                    }
                }

                if (numAttempts < this.qualityAgent.qualityConfig.maxRetries) {
                    console.log(`   Retrying frame generation...`);

                    onAttempt(numAttempts);

                    const GENERATE_IMAGE_SUCCESS_COOLDOWN = 6000;
                    console.log(`Waiting ${GENERATE_IMAGE_SUCCESS_COOLDOWN / 1000}s to avoid rate limit`);
                    await new Promise(resolve => setTimeout(resolve, GENERATE_IMAGE_SUCCESS_COOLDOWN));
                }
            }
        }

        if (bestImage && bestScore > 0) {
            const scorePercent = (bestScore * 100).toFixed(1);
            const thresholdPercent = (acceptanceThreshold * 100).toFixed(0);
            console.warn(`   ⚠️ Using best attempt: ${scorePercent}% (threshold: ${thresholdPercent}%)`);
            return {
                data: { image: bestImage },
                metadata: {
                    model: imageModelName,
                    attempts: totalAttempts,
                    acceptedAttempt: bestAttemptNumber,
                    evaluation: bestEvaluation!,
                    warning: `Quality below threshold after ${totalAttempts} attempts`
                }
            };
        }

        // const evaluateFn = async () => await this.qualityAgent.evaluateFrameQuality(
        //     frame,
        //     scene,
        //     framePosition,
        //     characters,
        //     locations,
        // );

        // const applyCorrectionsFn = async () => await this.qualityAgent.applyQualityCorrections(
        //     prompt,
        //     evaluation,
        //     scene,
        //     characters,
        //     numAttempts
        // );

        // const calculateScoreFn = async () => this.qualityAgent[ "calculateOverallScore" ](evaluation.scores);


        // await QualityRetryHandler.executeWithRetry(
        //     prompt,
        //     {
        //         qualityConfig: this.qualityAgent.qualityConfig,
        //         context: {
        //             assetKey: framePosition === "start" ? "scene_start_frame" : "scene_end_frame",
        //             sceneId: scene.id,
        //             sceneIndex: scene.sceneIndex,
        //             attempt: 1,
        //             maxAttempts: this.qualityAgent.qualityConfig.maxRetries,
        //             framePosition,
        //             projectId: scene.projectId
        //         }
        //     },
        //     {
        //         generate: async (prompt, currentAttemptNumber) => await this.generateImageWithSafetyRetry(
        //             scene,
        //             prompt,
        //             framePosition,
        //             objectParams,
        //             currentAttemptNumber,
        //             previousFrame,
        //             referenceImages,
        //             onProgress
        //         ),
        //         evaluate: evaluateFn,
        //         applyCorrections:,
        //         calculateScore: ,
        //         onComplete:,
        //         onProgress:,
        //     }
        // )

        throw new Error(`Failed to generate acceptable frame image after ${totalAttempts} attempts`);
    }

    /**
     * Internal: Generate scene with safety error retry.
     */
    private async generateImageWithSafetyRetry(
        scene: Scene,
        prompt: string,
        framePosition: "start" | "end",
        objectParams: FrameImageObjectParams,
        attempt: number,
        previousFrame: string | undefined,
        referenceImages: string[] = [],
        updateScene: UpdateSceneCallback,
    ) {

        const attemptLabel = attempt ? ` (Quality Attempt ${attempt})` : "";

        return await retryLlmCall(
            (params: { prompt: string; }) => this.executeGenerateImage(
                scene,
                params.prompt,
                framePosition,
                objectParams,
                previousFrame,
                referenceImages,
                updateScene,
            ),
            { prompt },
            {
                maxRetries: this.qualityAgent.qualityConfig.safetyRetries,
                initialDelay: 3000,
                backoffFactor: 2,
                attempt,
                projectId: scene.projectId
            },
            async (error: any, attempt: number, params) => {
                if (error instanceof RAIError) {
                    console.warn(`   ⚠️ Safety error ${attemptLabel}. Sanitizing...`);
                    params.prompt = await this.qualityAgent.sanitizePrompt(params.prompt, error.message);
                }
                return {
                    params,
                    attempt
                };
            }
        );
    }

    private async executeGenerateImage(
        scene: Scene,
        prompt: string,
        framePosition: "start" | "end",
        pathParams: FrameImageObjectParams,
        previousFrame: string | undefined,
        referenceImages: string[],
        updateScene: UpdateSceneCallback,
    ) {
        console.log(`   [FrameCompositionAgent] Generating frame for scene ${pathParams.sceneId} (${pathParams.type})...`);

        scene.progressMessage = `Generating ${pathParams.type.includes('start') ? 'start' : 'end'} frame image...`;
        scene.status = "generating";
        updateScene(scene, false);

        let contents: Part[] = [ { text: `Frame Description: ${prompt}` } ];
        const validReferenceImageUrls = [ previousFrame, ...referenceImages ].map(obj => obj).filter((url): url is string => typeof url === 'string' && url.length > 0);

        if (validReferenceImageUrls.length > 0) {
            const fileDataInputs = await this.prepareImageInputs(validReferenceImageUrls);
            const referenceInputs: Part[] = [];
            fileDataInputs.map(({ displayName, ...file }) => {
                referenceInputs.push({ text: displayName });
                referenceInputs.push({ fileData: file });
            });
            contents = [ ...referenceInputs, ...contents ];
        }

        const outputMimeType = "image/png";
        const result = await this.imageModel.generateContent({
            model: imageModelName,
            contents: contents,
            config: {
                abortSignal: this.options?.signal,
                responseModalities: [ Modality.IMAGE ],
                imageConfig: {
                    outputMimeType: outputMimeType
                }
            }
        });

        if (!result.candidates || result.candidates?.[ 0 ]?.content?.parts?.length === 0) {
            throw new Error("Image generation failed to return any images.");
        }

        const generatedImageData = result.candidates[ 0 ].content?.parts?.[ 0 ]?.inlineData?.data;
        if (!generatedImageData) {
            throw new Error("Generated image is missing inline data.");
        }

        const imageBuffer = Buffer.from(generatedImageData, "base64");

        const outputPath = this.storageManager.getObjectPath(pathParams);

        console.log(`   ... Uploading frame to ${outputPath}`);
        const frame = await this.storageManager.uploadBuffer(imageBuffer, outputPath, outputMimeType);

        console.log(`   ✓ Frame generated and uploaded: ${this.storageManager.getPublicUrl(frame)}`);

        scene.progressMessage = `Generated ${pathParams.type.includes('start') ? 'start' : 'end'} frame image`;
        scene.status = "complete";
        updateScene(scene, false);

        return frame;
    }

    async generateFrameGenerationPrompt(
        framePosition: "start" | "end",
        scene: Scene,
        characters: Character[],
        locations: Location[],
        previousScene?: Scene,
        generationRules?: string[]
    ): Promise<string> {

        let generateFramePromptInstructions = composeFrameGenerationPromptMeta(scene,
            framePosition,
            characters,
            locations,
            previousScene,
            generationRules
        );

        const _generateFrameGenerationPrompt = async () => {
            console.log(`\n📝 Generating Frame Prompt via LLM for Scene ${scene.id} (${framePosition})`);
            console.log(`   Meta-Prompt Instructions (First 500 chars):\n${generateFramePromptInstructions.substring(0, 500)}...`);

            const response = await this.llm.generateContent(buildllmParams({
                contents: generateFramePromptInstructions,
                config: {
                    abortSignal: this.options?.signal,
                    thinkingConfig: {
                        thinkingLevel: ThinkingLevel.HIGH
                    }
                }
            }));

            const content = response.text;

            if (!content) {
                console.warn("! generateFramePrompt was not generated. Using generateFramePromptInstructions");
                return generateFramePromptInstructions;
            }

            const cleanedContent = cleanJsonOutput(content);
            console.log(`   ✨ Generated Frame Prompt: "${cleanedContent}"`);
            return cleanedContent;
        };

        let frameGenerationPrompt = await _generateFrameGenerationPrompt();

        frameGenerationPrompt += composeGenerationRules(generationRules);
        return frameGenerationPrompt;
    }
}
