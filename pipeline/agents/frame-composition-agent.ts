import { FileData, Modality, Part } from "@google/genai";
import { GCPStorageManager, GcsObjectPathParams } from "../storage-manager";
import { LlmController } from "../llm/controller";
import { buildllmParams } from "../llm/google/llm-params";
import { imageModelName } from "../llm/google/models";
import { QualityCheckAgent } from "./quality-check-agent";
import { Character, Location, ObjectData, QualityEvaluationResult, Scene } from "../../shared/pipeline-types";

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

    async prepareImageInputs(url: string[]): Promise<Part[]> {
        return Promise.all(
            url.map(async (url) => {
                const filePathParts = url.split('/');
                const mimeType = await this.storageManager.getObjectMimeType(url);
                if (!mimeType) {
                    throw new Error(`Could not determine mime type for ${url}`);
                }
                return { fileData: { mimeType, fileUri: url, displayName: filePathParts[ filePathParts.length - 1 ] } };
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
    ): Promise<ObjectData> {
        if (!this.qualityAgent.qualityConfig.enabled && !!this.qualityAgent.evaluateFrameQuality) {
            const image = await this.executeGenerateImage(prompt, { type: framePosition === "start" ? "scene_start_frame" : "scene_end_frame", sceneId: scene.id, attempt: 1 }, previousFrame, referenceImages);
            return this.storageManager.buildObjectData(image);
        }

        return await this.generateImageWithQualityCheck(scene, prompt, framePosition, sceneCharacters, sceneLocations, previousFrame, referenceImages);
    }

    private async generateImageWithQualityCheck(
        scene: Scene,
        prompt: string,
        framePosition: "start" | "end",
        characters: Character[],
        locations: Location[],
        previousFrame: ObjectData | undefined,
        referenceImages: (ObjectData | undefined)[] = [],
    ): Promise<ObjectData> {

        let objectParams: GcsObjectPathParams;

        let bestFrame: string | null = null;
        let bestEvaluation: QualityEvaluationResult | null = null;
        let bestScore = 0;
        let totalAttempts = 0;

        for (let attempt = 1; attempt <= this.qualityAgent.qualityConfig.maxRetries; attempt++) {
            objectParams = { type: framePosition === "start" ? "scene_start_frame" : "scene_end_frame", sceneId: scene.id, attempt };

            totalAttempts = attempt;
            let evaluation: QualityEvaluationResult | null = null;
            let score = 0;
            let frame = "";
            try {
                frame = await this.executeGenerateImage(
                    prompt,
                    objectParams,
                    previousFrame,
                    referenceImages
                );

                console.log(`  🔍 Quality checking ${framePosition} frame for Scene ${scene.id}...`);
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

                this.qualityAgent[ "logAttemptResult" ](attempt, score, evaluation.overall);

                if (score >= this.qualityAgent.qualityConfig.minorIssueThreshold) {
                    console.log(`   ✅ Quality acceptable (${(score * 100).toFixed(1)}%)`);
                    return this.storageManager.buildObjectData(frame);
                }

                if (attempt >= this.qualityAgent.qualityConfig.maxRetries) {
                    break;
                }

                prompt = await this.qualityAgent.applyQualityCorrections(
                    prompt,
                    evaluation,
                    scene,
                    characters,
                    attempt
                );

                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (error) {
                console.warn(`   ⚠️ Frame quality issues for ${this.storageManager.getGcsObjectPath(objectParams)}`);

                if (evaluation && frame) {
                    const score = this.qualityAgent[ "calculateOverallScore" ](evaluation.scores);
                    if (score > bestScore) {
                        bestScore = score;
                        bestFrame = frame;
                        bestEvaluation = evaluation;
                    }
                }
                if (attempt < this.qualityAgent.qualityConfig.maxRetries) {
                    console.log(`   Retrying frame generation...`);
                    // Optionally adjust the prompt or strategy before retrying
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait before retry
                }
            }
        }

        if (bestFrame && bestScore > 0) {
            const scorePercent = (bestScore * 100).toFixed(1);
            const thresholdPercent = (this.qualityAgent.qualityConfig.acceptThreshold * 100).toFixed(0);
            console.warn(`   ⚠️ Using best attempt: ${scorePercent}% (threshold: ${thresholdPercent}%)`);

            return this.storageManager.buildObjectData(bestFrame);
        }

        throw new Error(`Failed to generate acceptable frame image after ${totalAttempts} attempts`);
    }

    private async executeGenerateImage(
        prompt: string,
        pathParams: GcsObjectPathParams,
        previousFrame: ObjectData | undefined,
        referenceImages: (ObjectData | undefined)[],
    ): Promise<string> {
        // console.log(`   [FrameCompositionAgent] Generating frame for scene ${pathParams.sceneId} (${pathParams.type})...`);

        const contents: Part[] = [ { text: prompt } ];
        const validReferenceImageUrls = [ previousFrame, ...referenceImages ].map(obj => obj?.storageUri).filter(url => typeof url !== 'undefined');

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
        const outputPath = await this.storageManager.getGcsObjectPath(pathParams);

        console.log(`   ... Uploading frame to ${outputPath}`);
        const gcsUri = await this.storageManager.uploadBuffer(imageBuffer, outputPath, outputMimeType);

        console.log(`   ✓ Frame generated and uploaded: ${this.storageManager.getPublicUrl(gcsUri)}`);
        return gcsUri;
    }
}
