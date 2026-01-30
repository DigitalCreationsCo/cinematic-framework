import { PersonGeneration, Video, Image, VideoGenerationReferenceType, Operation, GenerateVideosResponse } from "@google/genai";
import { GCPStorageManager } from "../services/storage-manager.js";
import { Character, Location, QualityEvaluationResult, Scene, SceneGenerationResult } from "../types/index.js";
import { GetAttemptMetricCallback, OnAttemptCallback, SaveAssetsCallback, UpdateSceneCallback } from "../types/pipeline.types.js";
import { RAIError } from "../utils/errors.js";
import ffmpeg from "fluent-ffmpeg";
import { buildVideoGenerationParams } from "../llm/google/google-llm-params.js";
import fs from "fs";
import { formatTime, roundToValidDuration } from "../utils/utils.js";
import { retryLlmCall } from "../utils/llm-retry.js";
import { VideoModelController } from "../llm/video-model-controller.js";
import { QualityCheckAgent } from "./quality-check-agent.js";
import { GraphInterrupt } from "@langchain/langgraph";
import { AssetVersionManager } from "../services/asset-version-manager.js";
import { qualityCheckModelName, videoModelName } from "../llm/google/models.js";
import { GenerativeResultEnvelope, GenerativeResultGenerateSceneVideo, JobRecordGenerateSceneVideo } from "../types/job.types.js";



export class SceneGeneratorAgent {
    private videoModel: VideoModelController;
    private storageManager: GCPStorageManager;
    private qualityAgent: QualityCheckAgent;
    private options?: { signal?: AbortSignal; };

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
        saveAssets,
        updateScene,
        onAttempt,
        saveMetric,
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
        saveAssets: SaveAssetsCallback,
        updateScene: UpdateSceneCallback,
        onAttempt: OnAttemptCallback,
        saveMetric: GetAttemptMetricCallback,
        generationRules?: string[],
    }): Promise<GenerativeResultGenerateSceneVideo> {

        console.log(`\n[Scene Generator]: Generating Scene ${scene.id}: ${formatTime(scene.duration)}`);

        if (!this.qualityAgent.qualityConfig.enabled || !this.qualityAgent) {
            const generatedWithoutQualityCheck = await this.generateSceneWithSafetyRetry(
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
                updateScene,
                onAttempt,
                saveMetric,
            );

            const setBestVersion = true;
            saveAssets(
                { projectId: scene.projectId, sceneId: scene.id },
                'scene_video',
                'video',
                [ generatedWithoutQualityCheck.videoUrl ],
                { model: videoModelName },
                setBestVersion,
            );

            updateScene(generatedWithoutQualityCheck.scene);

            return {
                data: generatedWithoutQualityCheck,
                metadata: {
                    model: videoModelName,
                    attempts: version,
                    acceptedAttempt: version
                }
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
            saveAssets,
            updateScene,
            onAttempt,
            saveMetric,
            generationRules,
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
        saveAssets?: SaveAssetsCallback,
        updateScene?: UpdateSceneCallback,
        onAttempt?: OnAttemptCallback,
        saveMetric?: GetAttemptMetricCallback,
        generationRules?: string[],
    ): Promise<GenerativeResultEnvelope<SceneGenerationResult>> {

        const startTime = Date.now();
        const acceptanceThreshold = this.qualityAgent.qualityConfig.minorIssueThreshold;

        let bestScene: Scene | null = null;
        let bestVideoUrl: string | null = null;
        let bestEvaluation: QualityEvaluationResult | null = null;
        let bestScore = 0;
        let bestAttemptNumber = 0;
        let totalAttempts = 0;
        let numAttempts = 1;

        for (let lastestAttempt = version + numAttempts; numAttempts <= this.qualityAgent.qualityConfig.maxRetries; numAttempts++) {
            totalAttempts = numAttempts;
            let evaluation: QualityEvaluationResult | null = null;
            let generated: { scene: Scene; videoUrl: string; } | null = null;
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
                    updateScene,
                    onAttempt,
                );

                evaluation = await this.qualityAgent.evaluateScene(
                    scene,
                    generated.videoUrl,
                    enhancedPrompt,
                    characters,
                    location,
                    lastestAttempt,
                    previousScene,
                    updateScene,
                    generationRules
                );

                saveAssets?.(
                    { projectId: scene.projectId, sceneId: scene.id },
                    'scene_video',
                    'video',
                    [ generated.videoUrl ],
                    {
                        model: videoModelName,
                        prompt: enhancedPrompt,
                        evaluation: JSON.stringify(evaluation),
                    },
                );

                saveMetric?.({
                    assetKey: "scene_video",
                    attemptNumber: lastestAttempt,
                    finalScore: evaluation.score,
                    ruleAdded: evaluation.promptCorrections?.map(c => c.correctedPromptSection)!,
                    assetVersion: bestAttemptNumber,
                    corrections: evaluation.promptCorrections!,
                    startTime,
                });

                saveAssets?.(
                    { projectId: scene.projectId, sceneId: scene.id },
                    'scene_quality_evaluation',
                    'text',
                    [ JSON.stringify(evaluation) ],
                    {
                        model: qualityCheckModelName,
                    },
                );

                if (evaluation.score > bestScore) {
                    bestScore = evaluation.score;
                    bestScene = generated.scene;
                    bestVideoUrl = generated.videoUrl;
                    bestEvaluation = evaluation;
                }

                this.qualityAgent[ "logAttemptResult" ](numAttempts, evaluation.score, evaluation.grade);

                if (evaluation.score >= acceptanceThreshold) {
                    console.log(`   ✅ Quality acceptable (${(evaluation.score * 100).toFixed(1)}%)`);

                    updateScene?.(generated.scene);

                    return {
                        data: {
                            scene: generated.scene,
                            videoUrl: generated.videoUrl,
                            enhancedPrompt: enhancedPrompt,
                        },
                        metadata: {
                            model: videoModelName,
                            attempts: totalAttempts,
                            evaluation,
                            acceptedAttempt: lastestAttempt
                        }
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
                    updateScene,
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

            updateScene?.(bestScene);

            saveMetric?.({
                assetKey: "scene_video",
                attemptNumber: bestAttemptNumber,
                finalScore: bestScore,
                ruleAdded: bestEvaluation?.promptCorrections?.map(c => c.correctedPromptSection)!,
                assetVersion: bestAttemptNumber,
                corrections: bestEvaluation?.promptCorrections!,
                startTime,
            });

            return {
                data: {
                    scene: bestScene,
                    videoUrl: bestVideoUrl,
                    enhancedPrompt: enhancedPrompt,
                },
                metadata: {
                    model: videoModelName,
                    attempts: totalAttempts,
                    evaluation: bestEvaluation!,
                    warning: `Quality below threshold after ${totalAttempts} attempts`,
                    acceptedAttempt: bestAttemptNumber
                }
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
        updateScene?: UpdateSceneCallback,
        onAttempt?: OnAttemptCallback,
        saveMetric?: GetAttemptMetricCallback,
    ): Promise<SceneGenerationResult> {

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
                updateScene,
                onAttempt
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
                backoffFactor: 2,
                projectId: scene.projectId
            },
            async (error, attempt, params): Promise<any> => {
                if (error instanceof RAIError) {
                    console.warn(`   ⚠️ Safety error ${attemptLabel}. Sanitizing...`);
                    const sanitizedPrompt = await this.qualityAgent.sanitizePrompt(params.prompt, error.message);
                    onAttempt?.(attempt);
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
            scene,
            enhancedPrompt,
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
        updateScene?: UpdateSceneCallback,
        onAttempt?: OnAttemptCallback,
    ): Promise<string> {

        console.log(`   Generating video with prompt: ${prompt.substring(0, 50)}...`);
        scene.progressMessage = "Initializing video generation...";
        scene.status = "pending";
        updateScene?.(scene);

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
        updateScene?.(scene);

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
        updateScene?.(scene);

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
