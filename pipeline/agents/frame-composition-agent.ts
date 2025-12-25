import { FileData, Modality, Part } from "@google/genai";
import { GCPStorageManager, GcsObjectPathParams } from "../storage-manager";
import { LlmController } from "../llm/controller";
import { buildllmParams } from "../llm/google/llm-params";
import { imageModelName } from "../llm/google/models";
import { QualityCheckAgent } from "./quality-check-agent";
import { Character, FrameGenerationResult, Location, ObjectData, QualityEvaluationResult, Scene, SceneStatus } from "../../shared/pipeline-types";
import { retryLlmCall } from "../lib/llm-retry";
import { RAIError } from "../lib/errors";
import { GraphInterrupt } from "@langchain/langgraph";

type FrameImageObjectParams = Extract<GcsObjectPathParams, ({ type: "scene_start_frame"; } | { type: "scene_end_frame"; })>;

export class FrameCompositionAgent {
    private imageModel: LlmController;
    private qualityAgent: QualityCheckAgent;
    private storageManager: GCPStorageManager;

    constructor(
        imageModel: LlmController,
        qualityAgent: QualityCheckAgent,
        storageManager: GCPStorageManager
    ) {
        this.imageModel = imageModel;
        this.qualityAgent = qualityAgent;
        this.storageManager = storageManager;
    }

    async prepareImageInputs(urls: string[]): Promise<Part[]> {

        return Promise.all(
            urls.map(async (u) => {
                const filePathParts = u.split('/');
                const mimeType = await this.storageManager.getObjectMimeType(u);
                if (!mimeType) {
                    throw new Error(`Could not determine mime type for ${u}`);
                }
                return { fileData: { mimeType, fileUri: u, displayName: filePathParts[ filePathParts.length - 1 ] } };
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
            const prevAttempt = this.storageManager.getLatestAttempt(framePosition === "start" ? "scene_start_frame" : "scene_end_frame", scene.id);

            return await this.executeGenerateImage(
                prompt,
                framePosition,
                { type: framePosition === "start" ? "scene_start_frame" : "scene_end_frame", sceneId: scene.id, attempt: prevAttempt + 1 },
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
            totalAttempts = numAttempts;
            let evaluation: QualityEvaluationResult | null = null;
            let score = 0;

            objectParams = { type: framePosition === "start" ? "scene_start_frame" : "scene_end_frame", sceneId: scene.id, attempt: latestAttempt };

            try {
                frame = await this.generateImageWithSafetyRetry(
                    prompt,
                    framePosition,
                    objectParams,
                    latestAttempt,
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

        const contents: Part[] = [ { text: prompt } ];
        const validReferenceImageUrls = [ previousFrame, ...referenceImages ].map(obj => obj?.storageUri).filter((url): url is string => typeof url === 'string' && url.length > 0);

        if (referenceImages.length) {
            const referenceInput = await this.prepareImageInputs(validReferenceImageUrls);
            contents.push(...referenceInput);
        }

        const outputMimeType = "image/png";
        const result = await this.imageModel.generateContent({
            model: imageModelName,
            contents: contents,
            config: {
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
        if ('sceneId' in pathParams && 'attempt' in pathParams && pathParams.attempt) {
            this.storageManager.updateLatestAttempt(pathParams.type, pathParams.sceneId, pathParams.attempt);
        }

        const outputPath = await this.storageManager.getGcsObjectPath(pathParams);

        console.log(`   ... Uploading frame to ${outputPath}`);
        const gcsUri = await this.storageManager.uploadBuffer(imageBuffer, outputPath, outputMimeType);

        const frame = this.storageManager.buildObjectData(gcsUri);
        console.log(`   ✓ Frame generated and uploaded: ${this.storageManager.getPublicUrl(gcsUri)}`);
        
        if (onProgress) onProgress(
            pathParams.sceneId,
            `Generated ${pathParams.type.includes('start') ? 'start' : 'end'} frame image`,
            "complete",
            framePosition === "start" ? { startFrame: frame } : { endFrame: frame }
        );

        return frame;
    }
}
