import { FileData, Modality, Part, ThinkingLevel } from "@google/genai";
import { GCPStorageManager, GcsObjectPathParams } from "../storage-manager";
import { TextModelController } from "../llm/text-model-controller";
import { buildllmParams } from "../llm/google/google-llm-params";
import { imageModelName } from "../llm/google/models";
import { QualityCheckAgent } from "./quality-check-agent";
import { Character, FrameGenerationResult, Location, ObjectData, QualityEvaluationResult, Scene, SceneStatus } from "../../shared/pipeline-types";
import { retryLlmCall } from "../lib/llm-retry";
import { RAIError } from "../lib/errors";
import { GraphInterrupt } from "@langchain/langgraph";
import { composeFrameGenerationPromptMeta } from "pipeline/prompts/prompt-composer";
import { cleanJsonOutput } from "pipeline/utils/utils";

type FrameImageObjectParams = Extract<GcsObjectPathParams, ({ type: "scene_start_frame"; } | { type: "scene_end_frame"; })>;

export class FrameCompositionAgent {
    private llm: TextModelController;
    private imageModel: TextModelController;
    private qualityAgent: QualityCheckAgent;
    private storageManager: GCPStorageManager;
    private options?: { signal?: AbortSignal; };

    constructor(
        llm: TextModelController,
        imageModel: TextModelController,
        qualityAgent: QualityCheckAgent,
        storageManager: GCPStorageManager,
        options?: { signal?: AbortSignal; }
    ) {
        this.llm = llm;
        this.imageModel = imageModel;
        this.qualityAgent = qualityAgent;
        this.storageManager = storageManager;
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

    async generateImage(
        scene: Scene,
        prompt: string,
        framePosition: "start" | "end",
        sceneCharacters: Character[],
        sceneLocations: Location[],
        previousFrame: ObjectData | undefined,
        referenceImages: (ObjectData | undefined)[],
        onProgress?: (sceneId: number, msg: string, status?: SceneStatus, artifacts?: { startFrame?: ObjectData, endFrame?: ObjectData; }) => void
    ): Promise<ObjectData> {
        if (!this.qualityAgent.qualityConfig.enabled && !!this.qualityAgent.evaluateFrameQuality) {
            const attempt = this.storageManager.getNextAttempt(framePosition === "start" ? "scene_start_frame" : "scene_end_frame", scene.id);

            return await this.executeGenerateImage(
                prompt,
                framePosition,
                { type: framePosition === "start" ? "scene_start_frame" : "scene_end_frame", sceneId: scene.id, attempt },
                previousFrame,
                referenceImages,
                onProgress
            );
        }

        const result = await this.generateImageWithQualityRetry(scene, prompt, framePosition, sceneCharacters, sceneLocations, previousFrame, referenceImages, onProgress);

        if (result.evaluation) {
            console.log(`   📊 Final: ${(result.finalScore * 100).toFixed(1)}% after ${result.attempts} attempt(s)`);
        }

        if (result.evaluation?.ruleSuggestion) {
            console.log(`\n📚 GENERATION RULE ADDED`);
            console.log(`   "${result.evaluation.ruleSuggestion}"`);
        }

        return result.frame;
    }

    private async generateImageWithQualityRetry(
        scene: Scene,
        prompt: string,
        framePosition: "start" | "end",
        characters: Character[],
        locations: Location[],
        previousFrame: ObjectData | undefined,
        referenceImages: (ObjectData | undefined)[] = [],
        onProgress?: (sceneId: number, msg: string, status?: SceneStatus, artifacts?: { startFrame?: ObjectData, endFrame?: ObjectData; }) => void
    ): Promise<FrameGenerationResult> {

        const acceptanceThreshold = this.qualityAgent.qualityConfig.minorIssueThreshold;

        let objectParams: FrameImageObjectParams;

        let bestFrame: ObjectData | null = null;
        let bestEvaluation: QualityEvaluationResult | null = null;
        let bestScore = 0;
        let totalAttempts = 0;
        let numAttempts = 1;

        let frame: ObjectData | null = null;

        const prevAttempt = this.storageManager.getLatestAttempt(framePosition === "start" ? "scene_start_frame" : "scene_end_frame", scene.id);

        for (let latestAttempt = prevAttempt + numAttempts; numAttempts <= this.qualityAgent.qualityConfig.maxRetries; numAttempts++) {
            // Get next attempt number for this iteration
            const currentAttemptNumber = this.storageManager.getNextAttempt(framePosition === "start" ? "scene_start_frame" : "scene_end_frame", scene.id);

            totalAttempts = numAttempts;
            let evaluation: QualityEvaluationResult | null = null;
            let score = 0;

            objectParams = { type: framePosition === "start" ? "scene_start_frame" : "scene_end_frame", sceneId: scene.id, attempt: currentAttemptNumber };

            try {
                frame = await this.generateImageWithSafetyRetry(
                    prompt,
                    framePosition,
                    objectParams,
                    currentAttemptNumber,
                    previousFrame,
                    referenceImages,
                    onProgress
                );

                console.log(`  🔍 Quality checking ${framePosition} frame for Scene ${scene.id}...`);
                if (onProgress) onProgress(scene.id, `Quality checking ${framePosition} frame...`, "evaluating");

                evaluation = await this.qualityAgent.evaluateFrameQuality(
                    frame,
                    scene,
                    framePosition,
                    characters,
                    locations,
                );

                score = this.qualityAgent[ "calculateOverallScore" ](evaluation.scores);

                if (score > bestScore) {
                    bestScore = score;
                    bestFrame = frame;
                    bestEvaluation = evaluation;
                }

                this.qualityAgent[ "logAttemptResult" ](numAttempts, score, evaluation.overall);

                if (score >= acceptanceThreshold) {
                    console.log(`   ✅ Quality acceptable (${(score * 100).toFixed(1)}%)`);
                    return {
                        frame,
                        attempts: totalAttempts,
                        finalScore: score,
                        evaluation
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

                console.warn(`   ⚠️ Frame quality issues for ${this.storageManager.getGcsObjectPath(objectParams)}`);

                if (evaluation && frame) {
                    const score = this.qualityAgent[ "calculateOverallScore" ](evaluation.scores);
                    if (score > bestScore) {
                        bestScore = score;
                        bestFrame = frame;
                        bestEvaluation = evaluation;
                    }
                }
                if (numAttempts < this.qualityAgent.qualityConfig.maxRetries) {
                    console.log(`   Retrying frame generation...`);

                    const GENERATE_IMAGE_SUCCESS_COOLDOWN = 6000;
                    console.log(`Waiting ${GENERATE_IMAGE_SUCCESS_COOLDOWN / 1000}s to avoid rate limit`);
                    await new Promise(resolve => setTimeout(resolve, GENERATE_IMAGE_SUCCESS_COOLDOWN));
                }
            }
        }

        if (bestFrame && bestScore > 0) {
            const scorePercent = (bestScore * 100).toFixed(1);
            const thresholdPercent = (acceptanceThreshold * 100).toFixed(0);
            console.warn(`   ⚠️ Using best attempt: ${scorePercent}% (threshold: ${thresholdPercent}%)`);

            return {
                frame: bestFrame,
                attempts: totalAttempts,
                finalScore: bestScore,
                evaluation: bestEvaluation!,
                warning: `Quality below threshold after ${totalAttempts} attempts`
            };
        }

        throw new Error(`Failed to generate acceptable frame image after ${totalAttempts} attempts`);
    }

    /**
     * Internal: Generate scene with safety error retry.
     */
    private async generateImageWithSafetyRetry(
        prompt: string,
        framePosition: "start" | "end",
        objectParams: FrameImageObjectParams,
        attempt: number,
        previousFrame: ObjectData | undefined,
        referenceImages: (ObjectData | undefined)[] = [],
        onProgress?: (sceneId: number, msg: string, status?: SceneStatus, artifacts?: { startFrame?: ObjectData, endFrame?: ObjectData; }) => void
    ) {

        const attemptLabel = attempt ? ` (Quality Attempt ${attempt})` : "";

        return await retryLlmCall(
            (prompt: string) => this.executeGenerateImage(
                prompt,
                framePosition,
                objectParams,
                previousFrame,
                referenceImages,
                onProgress
            ),
            prompt,
            {
                maxRetries: this.qualityAgent.qualityConfig.safetyRetries,
                initialDelay: 3000,
                backoffFactor: 2
            },
            async (error: any, attempt: number, currentPrompt: string) => {
                if (error instanceof RAIError) {
                    console.warn(`   ⚠️ Safety error ${attemptLabel}. Sanitizing...`);
                    return await this.qualityAgent.sanitizePrompt(currentPrompt, error.message);
                }
            }
        );
    }

    private async executeGenerateImage(
        prompt: string,
        framePosition: "start" | "end",
        pathParams: FrameImageObjectParams,
        previousFrame: ObjectData | undefined,
        referenceImages: (ObjectData | undefined)[],
        onProgress?: (sceneId: number, msg: string, status?: SceneStatus, artifacts?: { startFrame?: ObjectData, endFrame?: ObjectData; }) => void
    ) {
        console.log(`   [FrameCompositionAgent] Generating frame for scene ${pathParams.sceneId} (${pathParams.type})...`);
        
        if (onProgress) onProgress(pathParams.sceneId, `Generating ${pathParams.type.includes('start') ? 'start' : 'end'} frame image...`, "generating");

        let contents: Part[] = [ { text: `Frame Description: ${prompt}` } ];
        const validReferenceImageUrls = [ previousFrame, ...referenceImages ].map(obj => obj?.storageUri).filter((url): url is string => typeof url === 'string' && url.length > 0);

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

        // Update storage state with the current attempt if applicable
        if ('sceneId' in pathParams && 'attempt' in pathParams && typeof pathParams.attempt === 'number') {
            this.storageManager.updateLatestAttempt(pathParams.type, pathParams.sceneId, pathParams.attempt);
        }

        const outputPath = await this.storageManager.getGcsObjectPath(pathParams);

        console.log(`   ... Uploading frame to ${outputPath}`);
        const gcsUri = await this.storageManager.uploadBuffer(imageBuffer, outputPath, outputMimeType);

        const frame = this.storageManager.buildObjectData(gcsUri, result.modelVersion || imageModelName);
        console.log(`   ✓ Frame generated and uploaded: ${this.storageManager.getPublicUrl(gcsUri)}`);

        if (onProgress) onProgress(
            pathParams.sceneId,
            `Generated ${pathParams.type.includes('start') ? 'start' : 'end'} frame image`,
            "complete",
            framePosition === "start" ? { startFrame: frame } : { endFrame: frame }
        );

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
            previousScene
        );

        const rules = generationRules && generationRules.length > 0
            ? `\nGENERATION RULES:\n${generationRules.map((rule) => `- ${rule}`).join("\n")}`
            : "";
        generateFramePromptInstructions += rules;

        const generateFrameGenerationPrompt = async () => {
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

        const frameGenerationPrompt = await generateFrameGenerationPrompt();
        return frameGenerationPrompt;
    }
}
