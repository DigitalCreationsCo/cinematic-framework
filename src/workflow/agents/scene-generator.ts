import { PersonGeneration, Video, Image, VideoGenerationReferenceType, Operation, GenerateVideosResponse } from "@google/genai";
import { GCPStorageManager } from "../storage-manager";
import { Character, Location, GeneratedScene, QualityEvaluationResult, Scene, SceneGenerationResult, AttemptMetric, AssetStatus } from "../../shared/types/pipeline.types";
import { RAIError } from "../../shared/utils/errors";
import ffmpeg from "fluent-ffmpeg";
import { buildVideoGenerationParams, buildllmParams } from "../llm/google/google-llm-params";
import fs from "fs";
import { formatTime, roundToValidDuration } from "../../shared/utils/utils";
import { retryLlmCall } from "../../shared/utils/llm-retry";
import { VideoModelController } from "../llm/video-model-controller";
import { QualityCheckAgent } from "./quality-check-agent";
import { GraphInterrupt } from "@langchain/langgraph";
import { AssetVersionManager } from "../asset-version-manager";
import { videoModelName } from "../llm/google/models";



type OnProgressCallback = (scene: Scene, progress?: number) => void;

export class SceneGeneratorAgent {
    private videoModel: VideoModelController;
    private storageManager: GCPStorageManager;
    private qualityAgent: QualityCheckAgent;
    private options?: { signal?: AbortSignal; };
    private assetManager: AssetVersionManager;

    constructor(
        videoModel: VideoModelController,
        qualityAgent: QualityCheckAgent,
        storageManager: GCPStorageManager,
        assetManager: AssetVersionManager,
        options?: { signal?: AbortSignal; },
    ) {
        this.videoModel = videoModel;
        this.qualityAgent = qualityAgent;
        this.storageManager = storageManager;
        this.assetManager = assetManager;

        this.options = options;
    }

    /**
   * Generate scene with integrated quality control and retry logic.
   * All quality checking is contained within this method.
   */
    async generateSceneWithQualityCheck({
        scene,
        enhancedPrompt,
        sceneCharacters,
        sceneLocation,
        previousScene,
        version,
        startFrame,
        endFrame,
        characterReferenceImages,
        locationReferenceImages,
        generateAudio = false,
        onAttemptComplete,
        onProgress,
        onRetry,
        generationRules,
    }: {
        scene: Scene,
        enhancedPrompt: string,
        sceneCharacters: Character[],
        sceneLocation: Location,
        previousScene: Scene | undefined,
        version: number,
        startFrame?: string,
        endFrame?: string,
        characterReferenceImages?: string[],
        locationReferenceImages?: string[],
        generateAudio: boolean,
        onAttemptComplete?: (scene: Scene, metric: AttemptMetric) => void,
        onProgress?: OnProgressCallback,
        onRetry?: (attempt: number) => Promise<number>,
        generationRules?: string[],
    }): Promise<SceneGenerationResult> {

        console.log(`\n[Scene Generator]: Generating Scene ${scene.id}: ${formatTime(scene.duration)}`);

        if (!this.qualityAgent.qualityConfig.enabled || !this.qualityAgent) {
            const generated = await this.generateSceneWithSafetyRetry(
                scene,
                enhancedPrompt,
                version,
                startFrame,
                endFrame,
                characterReferenceImages,
                locationReferenceImages,
                previousScene,
                generateAudio,
                generationRules,
                onProgress,
                onRetry,
            );

            const setBestVersion = true;
            this.assetManager.createVersionedAssets(
                { projectId: scene.projectId, sceneId: scene.id },
                'scene_video',
                'video',
                [ generated.videoUrl ],
                { model: videoModelName },
                setBestVersion,
            );

            if (onAttemptComplete) {
                onAttemptComplete(generated.scene, {
                    sceneId: generated.scene.id,
                    attemptNumber: version,
                    finalScore: 1.0,
                });
            }

            return {
                scene: generated.scene,
                videoUrl: generated.videoUrl,
                attempts: version,
                finalScore: 1.0,
                evaluation: null,
                acceptedAttempt: version
            };
        }

        const generationResultWithEvaluation = await this.generateWithQualityRetry(
            scene,
            enhancedPrompt,
            sceneCharacters,
            sceneLocation,
            previousScene,
            version,
            startFrame,
            endFrame,
            characterReferenceImages,
            locationReferenceImages,
            generateAudio,
            onAttemptComplete,
            onProgress,
            onRetry,
            generationRules,
        );

        this.assetManager.createVersionedAssets(
            { projectId: scene.projectId, sceneId: scene.id },
            'scene_video',
            'video',
            [ generationResultWithEvaluation.videoUrl || "" ],
            {
                model: videoModelName,
                evaluation: generationResultWithEvaluation.evaluation,
            },
        );

        return generationResultWithEvaluation;
    }

    /**
   * Quality-controlled generation with retry logic.
   * Handles all quality evaluation, prompt correction, and retry attempts.
   */
    private async generateWithQualityRetry(
        scene: Scene,
        enhancedPrompt: string,
        characters: Character[],
        location: Location,
        previousScene: Scene | undefined,
        version: number,
        startFrame?: string,
        endFrame?: string,
        characterReferenceImages?: string[],
        locationReferenceImages?: string[],
        generateAudio = false,
        onAttemptComplete?: (scene: Scene, metric: AttemptMetric) => void,
        onProgress?: OnProgressCallback,
        onRetry?: (attempt: number) => Promise<number>,
        generationRules?: string[],
    ): Promise<SceneGenerationResult> {

        const acceptanceThreshold = this.qualityAgent.qualityConfig.minorIssueThreshold;

        let bestScene: GeneratedScene | null = null;
        let bestVideoUrl: string | null = null;
        let bestEvaluation: QualityEvaluationResult | null = null;
        let bestScore = 0;
        let bestAttemptNumber = 0;
        let totalAttempts = 0;
        let numAttempts = 1;

        for (let lastestAttempt = version + numAttempts; numAttempts <= this.qualityAgent.qualityConfig.maxRetries; numAttempts++) {
            totalAttempts = numAttempts;
            let evaluation: QualityEvaluationResult | null = null;
            let score = 0;
            let generated: { scene: GeneratedScene; videoUrl: string; } | null = null;
            try {

                generated = await this.generateSceneWithSafetyRetry(
                    scene,
                    enhancedPrompt,
                    lastestAttempt,
                    startFrame,
                    endFrame,
                    characterReferenceImages,
                    locationReferenceImages,
                    previousScene,
                    generateAudio,
                    generationRules,
                    onProgress,
                    onRetry,
                );

                evaluation = await this.qualityAgent.evaluateScene(
                    scene,
                    generated.videoUrl,
                    enhancedPrompt,
                    characters,
                    location,
                    lastestAttempt,
                    previousScene,
                    onProgress,
                    generationRules
                );

                score = this.qualityAgent[ "calculateOverallScore" ](evaluation.scores);

                if (score > bestScore) {
                    bestScore = score;
                    bestScene = generated.scene;
                    bestVideoUrl = generated.videoUrl;
                    bestEvaluation = evaluation;
                }

                this.qualityAgent[ "logAttemptResult" ](numAttempts, score, evaluation.overall);

                if (score >= acceptanceThreshold) {
                    console.log(`   ✅ Quality acceptable (${(score * 100).toFixed(1)}%)`);

                    if (onAttemptComplete) {
                        onAttemptComplete(generated.scene, {
                            sceneId: generated.scene.id,
                            attemptNumber: lastestAttempt,
                            finalScore: score,
                        });
                    }

                    return {
                        scene: generated.scene,
                        videoUrl: generated.videoUrl,
                        attempts: totalAttempts,
                        finalScore: score,
                        evaluation,
                        acceptedAttempt: lastestAttempt
                    };
                }

                if (numAttempts >= this.qualityAgent.qualityConfig.maxRetries) {
                    break;
                }

                enhancedPrompt = await this.qualityAgent.applyQualityCorrections(
                    enhancedPrompt,
                    evaluation,
                    scene,
                    characters,
                    lastestAttempt,
                    onProgress
                );

                await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (error) {
                if (error instanceof GraphInterrupt) throw error;

                console.error(`   ✗ Attempt ${numAttempts} failed:`, error);
                if (evaluation && generated) {
                    const score = this.qualityAgent[ "calculateOverallScore" ](evaluation.scores);
                    if (score > bestScore) {
                        bestScore = score;
                        bestScene = generated.scene;
                        bestVideoUrl = generated.videoUrl;
                        bestEvaluation = evaluation;
                        bestAttemptNumber = lastestAttempt;
                    }
                }
                if (numAttempts < this.qualityAgent.qualityConfig.maxRetries) {
                    console.log(`   Retrying scene generation...`);
                    // Optionally adjust the prompt or strategy before retrying
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait before retry
                }
            }
        }

        if (bestScene && bestVideoUrl && bestScore > 0) {
            const scorePercent = (bestScore * 100).toFixed(1);
            const thresholdPercent = (acceptanceThreshold * 100).toFixed(0);
            console.warn(`   ⚠️ Using best attempt: ${scorePercent}% (threshold: ${thresholdPercent}%)`);

            if (onAttemptComplete) {
                onAttemptComplete(bestScene, {
                    sceneId: bestScene.id,
                    attemptNumber: bestAttemptNumber,
                    finalScore: bestScore,
                });
            }

            return {
                scene: bestScene,
                videoUrl: bestVideoUrl,
                attempts: totalAttempts,
                finalScore: bestScore,
                evaluation: bestEvaluation!,
                warning: `Quality below threshold after ${totalAttempts} attempts`,
                acceptedAttempt: bestAttemptNumber
            };
        }

        throw new Error(`Failed to generate acceptable scene after ${totalAttempts} attempts`);
    }

    /**
   * Internal: Generate scene with safety error retry.
   */
    private async generateSceneWithSafetyRetry(
        scene: Scene,
        enhancedPrompt: string,
        version: number,
        startFrame?: string,
        endFrame?: string,
        characterReferenceImages?: string[],
        locationReferenceImages?: string[],
        previousScene?: Scene,
        generateAudio = false,
        generationRules?: string[],
        onProgress?: OnProgressCallback,
        onRetry?: (attempt: number) => Promise<number>,
    ): Promise<{ scene: GeneratedScene, videoUrl: string }> {
        console.log(`\n🎬 Generating Scene ${scene.id}: ${formatTime(scene.duration)}`);
        console.log(`   Duration: ${scene.duration}s | Shot: ${scene.shotType}`);
        const attemptLabel = version ? ` (Quality Attempt ${version})` : "";
        let finalPrompt = enhancedPrompt;
        const maxRetries = this.qualityAgent.qualityConfig.safetyRetries + version;
        const generatedVideo = await retryLlmCall(
            (params: { prompt: string; startFrame?: string; endFrame?: string; }) => this.executeVideoGeneration(
                scene,
                params.prompt,
                scene.duration,
                scene.id,
                version,
                params.startFrame,
                params.endFrame,
                characterReferenceImages,
                locationReferenceImages,
                previousScene,
                generateAudio,
                onProgress
            ),
            {
                prompt: finalPrompt,
                startFrame: startFrame,
                endFrame: endFrame,
            },
            {
                attempt: version,
                maxRetries,
                initialDelay: 1000,
                backoffFactor: 2
            },
            async (error, attempt, params): Promise<any> => {
                if (error instanceof RAIError) {
                    console.warn(`   ⚠️ Safety error ${attemptLabel}. Sanitizing...`);
                    const sanitizedPrompt = await this.qualityAgent.sanitizePrompt(params.prompt, error.message);
                    attempt = await onRetry?.(attempt) || attempt;
                    return {
                        attempt,
                        params: {
                            ...params,
                            prompt: sanitizedPrompt
                        },
                    };
                }
            }
        );

        return {
            scene: {
                ...scene,
                enhancedPrompt,
            },
            videoUrl: generatedVideo
        };
    }

    private async executeVideoGeneration(
        scene: Scene,
        prompt: string,
        duration: number,
        sceneId: string,
        version: number,
        startFrame?: string,
        endFrame?: string,
        characerterReferenceUrls?: string[],
        locationReferenceUrls?: string[],
        previousScene?: Scene,
        generateAudio = false,
        onProgress?: OnProgressCallback,
    ): Promise<string> {

        console.log(`   Generating video with prompt: ${prompt.substring(0, 50)}...`);
        scene.progressMessage = "Initializing video generation...";
        scene.status = "pending";
        if (onProgress) onProgress(scene);

        const outputMimeType = "video/mp4";
        const objectPath = this.storageManager.getObjectPath({ type: "scene_video", sceneId: sceneId, attempt: version });

        let durationSeconds = roundToValidDuration(duration);

        const imageParam = startFrame ? {
            image: {
                gcsUri: startFrame,
                mimeType: await this.storageManager.getObjectMimeType(startFrame) || "image/png"
            }
        } : undefined;

        const lastFrame = endFrame ? {
            gcsUri: endFrame,
            mimeType: await this.storageManager.getObjectMimeType(endFrame) || "image/png"
        } : undefined;

        const previousSceneVideo = previousScene?.assets[ "scene_video" ]?.versions[ previousScene?.assets[ "scene_video" ].best ].data;
        const sourceParam: { video: Video; } | { image: Image; } | undefined = previousSceneVideo ? {
            video: {
                uri: previousSceneVideo,
                mimeType: await this.storageManager.getObjectMimeType(previousSceneVideo),
            }
        } : imageParam;

        const characterReferenceImages = characerterReferenceUrls ? await Promise.all(characerterReferenceUrls.filter(obj => !!obj).map(async obj => ({
            image: {
                gcsUri: this.storageManager.getGcsUrl(obj),
                mimeType: await this.storageManager.getObjectMimeType(obj) || "image/png",
            },
            referenceType: VideoGenerationReferenceType.ASSET
        }))) : [];

        const locationReferenceImages = locationReferenceUrls ? await Promise.all(locationReferenceUrls.filter(obj => !!obj).map(async obj => ({
            image: {
                gcsUri: this.storageManager.getGcsUrl(obj),
                mimeType: await this.storageManager.getObjectMimeType(obj) || "image/png",
            },
            referenceType: VideoGenerationReferenceType.ASSET
        }))) : [];

        // veo2: 'last frame and reference images cannot be both set.'
        const allReferenceImages = [ ...characterReferenceImages, ...locationReferenceImages ];

        const videoGenParams = buildVideoGenerationParams({
            prompt,
            ...imageParam,
            // ...sourceParam, // veo2: 'Video and reference images cannot be both set.'
            config: {
                abortSignal: this.options?.signal,
                lastFrame: lastFrame,
                generateAudio,
                resolution: "720p",
                durationSeconds,
                numberOfVideos: 1,
                personGeneration: PersonGeneration.ALLOW_ALL,
                negativePrompt: "children, celebrity, famous person, photorealistic representation of real person, distorted face, watermark, text, bad quality",
            }
        });

        let operation: Operation<GenerateVideosResponse>;
        try {
            operation = await this.videoModel.generateVideos(videoGenParams);
        } catch (error) {
            console.error("   Error generating video: ", error);
            throw error;
        }

        const startTime = Date.now();
        const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

        console.log(`   ... Operation started: ${operation.name}`);
        scene.progressMessage = "Video generation in progress (remote)...";
        scene.status = "generating";
        if (onProgress) onProgress(scene);

        const SCENE_GEN_WAITTIME_MS = 10000;
        while (!operation.done) {
            if (Date.now() - startTime > TIMEOUT_MS) {
                throw new Error(`Video generation timed out after ${TIMEOUT_MS / 1000 / 60} minutes`);
            }

            console.log(`   ... waiting ${SCENE_GEN_WAITTIME_MS / 1000}s for video generation to complete`);
            await new Promise(resolve => setTimeout(resolve, SCENE_GEN_WAITTIME_MS));

            operation = await this.videoModel.getVideosOperation({ operation, config: { abortSignal: this.options?.signal } });
        }

        if (operation.error) {
            if ([ 'safety', 'violate', 'responsible' ].some(str => (operation.error?.message as string).includes(str))) {
                throw new RAIError(operation.error.message as string);
            }
            throw operation.error;
        }

        if (operation.response?.raiMediaFilteredCount && operation.response?.raiMediaFilteredCount > 0) {
            if (operation.response.raiMediaFilteredReasons && operation.response.raiMediaFilteredReasons.length > 0) {
                console.error("RAI Media Filtered: ", JSON.stringify(operation.response, null, 2));
                const raiErrors = operation.response.raiMediaFilteredReasons.reduce((acc, curr) => acc.concat(`${curr}. `), "");
                throw new RAIError(raiErrors);
            }
            throw new RAIError("Video generation violated AI usage guidelines");
        }
        const generatedVideos = operation.response?.generatedVideos;
        if (!generatedVideos || generatedVideos.length === 0 || !generatedVideos[ 0 ].video?.videoBytes) {
            console.log("Operation completed but no video data returned. operation: ", JSON.stringify(operation, null, 2));
            throw new Error("Operation completed but no video data returned.");
        }

        const videoBytesBase64 = generatedVideos[ 0 ].video.videoBytes;
        const videoBuffer = Buffer.from(videoBytesBase64, "base64");

        console.log(`   ... Uploading generated video to ${objectPath}`);
        const generatedVideo = await this.storageManager.uploadBuffer(videoBuffer, objectPath, outputMimeType);

        console.log(`   ✓ Video generated and uploaded: ${this.storageManager.getPublicUrl(generatedVideo)}`);


        scene.progressMessage = "Video generated";
        scene.status = "complete";
        if (onProgress) onProgress(scene);

        return generatedVideo;
    }

    /**
     * Extracts end frame video file - used for scene continuation.
     * @param videoUrl 
     * @param sceneId 
     * @param attempt 
     * @returns 
     */
    async extractEndFrameFromVideo(
        videoUrl: string,
        sceneId: string,
        attempt: number
    ): Promise<string> {
        const tempVideoPath = `/tmp/scene_${sceneId}.mp4`;
        const tempFramePath = `/tmp/scene_${sceneId}_lastframe.png`;

        try {
            await this.storageManager.downloadFile(videoUrl, tempVideoPath);

            return new Promise((resolve, reject) => {
                const framePath = this.storageManager.getObjectPath({ type: "scene_end_frame", sceneId: sceneId, attempt });
                let ffmpegError = '';

                ffmpeg.ffprobe(tempVideoPath, (err, metadata) => {
                    if (err) {
                        const probeError = new Error(`Failed to probe video: ${err.message}`);
                        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
                        reject(probeError);
                        return;
                    }

                    const duration = metadata.format.duration;
                    if (!duration || duration <= 0) {
                        const durationError = new Error(`Invalid video duration: ${duration}`);
                        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
                        reject(durationError);
                        return;
                    }

                    const seekTime = Math.max(0, duration - 0.1);

                    const command = ffmpeg(tempVideoPath)
                        .on("start", function (commandLine) {
                            console.log(`   [ffmpeg] Extracting last frame: ${commandLine}`);
                        })
                        .on("stderr", function (stderrLine) {
                            ffmpegError += stderrLine + "\n";
                        })
                        .on("error", (err: Error) => {
                            ffmpegError += err.message;
                            const finalError = new Error(`ffmpeg failed to extract frame: ${err.message}\nFFMPEG stderr:\n${ffmpegError}`);
                            if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
                            if (fs.existsSync(tempFramePath)) fs.unlinkSync(tempFramePath);
                            reject(finalError);
                        })
                        .on("end", async () => {
                            try {
                                if (!fs.existsSync(tempFramePath)) {
                                    const finalError = new Error(`Frame extraction failed. File not found at ${tempFramePath}.\nFFMPEG stderr:\n${ffmpegError}`);
                                    reject(finalError);
                                    return;
                                }

                                const fileBuffer = fs.readFileSync(tempFramePath);
                                const gcsUrl = await this.storageManager.uploadBuffer(fileBuffer, framePath, "image/png");
                                console.log(`   ✓ Last frame extracted: ${this.storageManager.getPublicUrl(gcsUrl)}`);
                                resolve(gcsUrl);
                            } catch (err) {
                                reject(err);
                            } finally {
                                if (fs.existsSync(tempFramePath)) fs.unlinkSync(tempFramePath);
                                if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
                            }
                        })
                        .seekInput(seekTime)
                        .outputOptions([
                            "-vframes", "1",
                            "-q:v", "2"
                        ])
                        .save(tempFramePath);
                });
            });
        } catch (error) {
            if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
            throw error;
        }
    }
}
