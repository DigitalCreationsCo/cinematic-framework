import { PersonGeneration, Video, Image, VideoGenerationReferenceType, Operation, GenerateVideosResponse } from "@google/genai";
import { GCPStorageManager } from "../storage-manager";
import { Character, Location, GeneratedScene, QualityEvaluationResult, Scene, SceneGenerationResult, AttemptMetric, ObjectData } from "../../shared/pipeline-types";
import { RAIError } from "../lib/errors";
import ffmpeg from "fluent-ffmpeg";
import { buildVideoGenerationParams, buildllmParams } from "../llm/google/llm-params";
import fs from "fs";
import path from "path";
import { formatTime, roundToValidDuration } from "../utils";
import { retryLlmCall } from "../lib/llm-retry";
import { LlmController } from "../llm/controller";
import { buildSafetyGuidelinesPrompt } from "../prompts/safety-instructions";
import { QualityCheckAgent } from "./quality-check-agent";

export class SceneGeneratorAgent {
    private llm: LlmController;
    private storageManager: GCPStorageManager;
    private qualityAgent: QualityCheckAgent;

    constructor(
        llm: LlmController,
        qualityAgent: QualityCheckAgent,
        storageManager: GCPStorageManager,
    ) {
        this.llm = llm;
        this.qualityAgent = qualityAgent;
        this.storageManager = storageManager;

    }

    /**
   * Generate scene with integrated quality control and retry logic.
   * All quality checking is contained within this method.
   */
    async generateSceneWithQualityCheck(
        scene: Scene,
        enhancedPrompt: string,
        characters: Character[],
        location: Location,
        previousScene: Scene | undefined,
        currentAttempt: number = 0,
        startFrame?: ObjectData,
        endFrame?: ObjectData,
        characterReferenceImages?: ObjectData[],
        locationReferenceImages?: ObjectData[],
        generateAudio: boolean = false,
        onAttemptComplete?: (metric: AttemptMetric) => void,
    ): Promise<SceneGenerationResult> {

        console.log(`\n🎬 Generating Scene ${scene.id}: ${formatTime(scene.duration)}`);
        console.log(`   Duration: ${scene.duration}s | Shot: ${scene.shotType}`);

        const prevAttempt = currentAttempt;

        if (!this.qualityAgent.qualityConfig.enabled || !this.qualityAgent) {
            const generated = await this.generateScene(
                scene,
                enhancedPrompt,
                prevAttempt + 1,
                startFrame,
                endFrame,
                characterReferenceImages,
                locationReferenceImages,
                previousScene,
                generateAudio
            );

            if (onAttemptComplete) {
                onAttemptComplete({
                    sceneId: scene.id,
                    attemptNumber: 1,
                    finalScore: 1.0,
                });
            }

            return {
                scene: generated,
                attempts: 1,
                finalScore: 1.0,
                evaluation: null,
                usedAttempt: prevAttempt + 1
            };
        }

        return await this.generateWithQualityRetry(
            scene,
            enhancedPrompt,
            characters,
            location,
            previousScene,
            prevAttempt,
            startFrame,
            endFrame,
            characterReferenceImages,
            locationReferenceImages,
            generateAudio,
            onAttemptComplete
        );
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
        currentAttempt: number,
        startFrame?: ObjectData,
        endFrame?: ObjectData,
        characterReferenceImages?: ObjectData[],
        locationReferenceImages?: ObjectData[],
        generateAudio = false,
        onAttemptComplete?: (metric: AttemptMetric) => void,
    ): Promise<SceneGenerationResult> {

        const acceptanceThreshold = this.qualityAgent.qualityConfig.minorIssueThreshold;

        let bestScene: GeneratedScene | null = null;
        let bestEvaluation: QualityEvaluationResult | null = null;
        let bestScore = 0;
        let bestAttemptNumber = 0;
        let totalAttempts = 0;
        let numAttempts = 1;

        const prevAttempt = currentAttempt;

        for (let lastestAttempt = prevAttempt + numAttempts; numAttempts <= this.qualityAgent.qualityConfig.maxRetries; numAttempts++) {
            totalAttempts = numAttempts;
            let evaluation: QualityEvaluationResult | null = null;
            let score = 0;
            let generated: GeneratedScene | null = null;
            try {
                // Generate scene with safety retry wrapper
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
                );

                evaluation = await this.qualityAgent.evaluateScene(
                    scene,
                    generated.generatedVideo,
                    enhancedPrompt,
                    characters,
                    location,
                    lastestAttempt,
                    previousScene,
                );

                score = this.qualityAgent[ "calculateOverallScore" ](evaluation.scores);

                if (score > bestScore) {
                    bestScore = score;
                    bestScene = generated;
                    bestEvaluation = evaluation;
                }

                this.qualityAgent[ "logAttemptResult" ](numAttempts, score, evaluation.overall);

                if (onAttemptComplete) {
                    onAttemptComplete({
                        sceneId: scene.id,
                        attemptNumber: lastestAttempt,
                        finalScore: score,
                    });
                }

                if (score >= acceptanceThreshold) {
                    console.log(`   ✅ Quality acceptable (${(score * 100).toFixed(1)}%)`);
                    return {
                        scene: generated,
                        attempts: totalAttempts,
                        finalScore: score,
                        evaluation,
                        usedAttempt: lastestAttempt
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
                    lastestAttempt
                );

                await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (error) {
                console.error(`   ✗ Attempt ${numAttempts} failed:`, error);
                if (evaluation && generated) {
                    const score = this.qualityAgent[ "calculateOverallScore" ](evaluation.scores);
                    if (score > bestScore) {
                        bestScore = score;
                        bestScene = generated;
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

        if (bestScene && bestScore > 0) {
            const scorePercent = (bestScore * 100).toFixed(1);
            const thresholdPercent = (acceptanceThreshold * 100).toFixed(0);
            console.warn(`   ⚠️ Using best attempt: ${scorePercent}% (threshold: ${thresholdPercent}%)`);

            return {
                scene: bestScene,
                attempts: totalAttempts,
                finalScore: bestScore,
                evaluation: bestEvaluation!,
                warning: `Quality below threshold after ${totalAttempts} attempts`,
                usedAttempt: bestAttemptNumber
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
        attempt: number,
        startFrame?: ObjectData,
        endFrame?: ObjectData,
        characterReferenceImages?: ObjectData[],
        locationReferenceImages?: ObjectData[],
        previousScene?: Scene,
        generateAudio = false,
    ) {

        const attemptLabel = attempt ? ` (Quality Attempt ${attempt})` : "";

        return await retryLlmCall(
            (prompt: string) => this.generateScene(
                scene,
                prompt,
                attempt,
                startFrame,
                endFrame,
                characterReferenceImages,
                locationReferenceImages,
                previousScene,
                generateAudio,
            ),
            enhancedPrompt,
            {
                maxRetries: this.qualityAgent.qualityConfig.safetyRetries,
                initialDelay: 1000,
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

    private async generateScene(
        scene: Scene,
        enhancedPrompt: string,
        attempt: number,
        startFrame?: ObjectData,
        endFrame?: ObjectData,
        characerterReferenceUrls?: ObjectData[],
        locationReferenceUrls?: ObjectData[],
        previousScene?: Scene,
        generateAudio = false,
    ): Promise<GeneratedScene> {
        try {
            console.log(`\n🎬 Generating Scene ${scene.id}: ${formatTime(scene.duration)}`);
            console.log(`   Duration: ${scene.duration}s | Shot: ${scene.shotType}`);

            const videoUrl = await this.executeVideoGeneration(
                enhancedPrompt,
                scene.duration,
                scene.id,
                attempt,
                startFrame,
                endFrame,
                characerterReferenceUrls,
                locationReferenceUrls,
                previousScene,
                generateAudio,
            );

            return {
                ...scene,
                enhancedPrompt,
                generatedVideo: videoUrl,
                endFrame,
            };
        } catch (error) {
            if (error instanceof RAIError) {
                throw error;
            }
            console.error(`   ✗ Failed to generate scene ${scene.id}:`, error);
            throw error;
        }
    }

    private async executeVideoGeneration(
        prompt: string,
        duration: number,
        sceneId: number,
        attempt: number,
        startFrame?: ObjectData,
        endFrame?: ObjectData,
        characerterReferenceUrls?: ObjectData[],
        locationReferenceUrls?: ObjectData[],
        previousScene?: Scene,
        generateAudio = false
    ): Promise<ObjectData> {
        console.log(`   Generating video with prompt: ${prompt.substring(0, 50)}...`);

        const outputMimeType = "video/mp4";
        const objectPath = this.storageManager.getGcsObjectPath({ type: "scene_video", sceneId: sceneId, attempt });

        let durationSeconds = roundToValidDuration(duration);

        const imageParam = startFrame?.storageUri ? {
            image: {
                gcsUri: startFrame.storageUri,
                mimeType: await this.storageManager.getObjectMimeType(startFrame.storageUri) || "image/png"
            }
        } : undefined;

        const lastFrame = endFrame?.storageUri ? {
            gcsUri: endFrame.storageUri,
            mimeType: await this.storageManager.getObjectMimeType(endFrame.storageUri) || "image/png"
        } : undefined;

        const sourceParam: { video: Video; } | { image: Image; } | undefined = previousScene?.generatedVideo?.storageUri ? {
            video: {
                uri: previousScene.generatedVideo.storageUri,
                mimeType: await this.storageManager.getObjectMimeType(previousScene.generatedVideo.storageUri),
            }
        } : imageParam;

        const characterReferenceImages = characerterReferenceUrls ? await Promise.all(characerterReferenceUrls.filter(obj => !!obj.storageUri).map(async obj => ({
            image: {
                gcsUri: this.storageManager.getGcsUrl(obj.storageUri),
                mimeType: await this.storageManager.getObjectMimeType(obj.storageUri) || "image/png",
            },
            referenceType: VideoGenerationReferenceType.ASSET
        }))) : [];

        const locationReferenceImages = locationReferenceUrls ? await Promise.all(locationReferenceUrls.filter(obj => !!obj.storageUri).map(async obj => ({
            image: {
                gcsUri: this.storageManager.getGcsUrl(obj.storageUri),
                mimeType: await this.storageManager.getObjectMimeType(obj.storageUri) || "image/png",
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
            operation = await this.llm.generateVideos(videoGenParams);
        } catch (error) {
            console.error("   Error generating video: ", error);
            throw error;
        }

        const startTime = Date.now();
        const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

        console.log(`   ... Operation started: ${operation.name}`);

        const SCENE_GEN_WAITTIME_MS = 10000;
        while (!operation.done) {
            if (Date.now() - startTime > TIMEOUT_MS) {
                throw new Error(`Video generation timed out after ${TIMEOUT_MS / 1000 / 60} minutes`);
            }

            console.log(`   ... waiting ${SCENE_GEN_WAITTIME_MS / 1000}s for video generation to complete`);
            await new Promise(resolve => setTimeout(resolve, SCENE_GEN_WAITTIME_MS));

            operation = await this.llm.getVideosOperation({ operation });
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
        const gcsUri = await this.storageManager.uploadBuffer(videoBuffer, objectPath, outputMimeType);

        console.log(`   ✓ Video generated and uploaded: ${this.storageManager.getPublicUrl(gcsUri)}`);
        return this.storageManager.buildObjectData(gcsUri);
    }

    async extractEndFrameFromVideo(
        videoUrl: string,
        sceneId: number,
        attempt: number
    ): Promise<string> {
        const tempVideoPath = `/tmp/scene_${sceneId}.mp4`;
        const tempFramePath = `/tmp/scene_${sceneId}_lastframe.png`;

        try {
            await this.storageManager.downloadFile(videoUrl, tempVideoPath);

            return new Promise((resolve, reject) => {
                const framePath = this.storageManager.getGcsObjectPath({ type: "scene_end_frame", sceneId: sceneId, attempt });
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

    async stitchScenes(videoPaths: string[], audioPath: string): Promise<ObjectData> {
        console.log(`\n🎬 Stitching ${videoPaths.length} scenes...`);

        const tmpDir = "/tmp";
        const fileListPath = path.join(tmpDir, "concat_list.txt");
        const intermediateVideoPath = path.join(tmpDir, "intermediate_movie.mp4");
        const finalVideoPath = path.join(tmpDir, "final_movie.mp4");
        const downloadedFiles: string[] = [];
        const localAudioPath = path.join(tmpDir, "audio.mp3");

        try {
            console.log("   ... Downloading clips and audio...");
            await this.storageManager.downloadFile(audioPath, localAudioPath);
            await Promise.all(videoPaths.map(async (pathUrl, i) => {
                const localPath = path.join(tmpDir, `clip_${i}.mp4`);
                await this.storageManager.downloadFile(pathUrl, localPath);
                downloadedFiles[ i ] = localPath; // Ensure order is preserved
            }));

            const fileListContent = downloadedFiles.map(f => `file \'${f}\'`).join("\n");
            fs.writeFileSync(fileListPath, fileListContent);

            console.log("   ... Stitching videos with ffmpeg");
            await new Promise<void>((resolve, reject) => {
                ffmpeg()
                    .input(fileListPath)
                    .inputOptions([ "-f", "concat", "-safe", "0" ])
                    .outputOptions("-c copy")
                    .save(intermediateVideoPath)
                    .on("end", () => resolve())
                    .on("error", (err: Error) => reject(err));
            });

            console.log("   ... Adding audio track to the final video");
            await new Promise<void>((resolve, reject) => {
                ffmpeg()
                    .input(intermediateVideoPath)
                    .input(localAudioPath)
                    .outputOptions([ "-c:v", "copy", "-c:a", "aac", "-strict", "experimental" ])
                    .save(finalVideoPath)
                    .on("end", () => resolve())
                    .on("error", (err: Error) => reject(err));
            });

            const objectPath = await this.storageManager.getGcsObjectPath({ type: "stitched_video" });
            console.log(`   ... Uploading stitched video to ${objectPath}`);
            const gcsUri = await this.storageManager.uploadFile(finalVideoPath, objectPath);

            console.log(`   ✓ Rendered video uploaded: ${this.storageManager.getPublicUrl(gcsUri)}`);

            const video = this.storageManager.buildObjectData(gcsUri);
            return video;

        } catch (error) {
            console.error("   ✗ Failed to stitch scenes:", error);
            throw error;
        }
        finally {
            if (fs.existsSync(fileListPath)) fs.unlinkSync(fileListPath);
            if (fs.existsSync(intermediateVideoPath)) fs.unlinkSync(intermediateVideoPath);
            if (fs.existsSync(finalVideoPath)) fs.unlinkSync(finalVideoPath);
            if (fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);
            downloadedFiles.forEach(f => {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            });
        }
    }

    async stitchScenesWithoutAudio(videoPaths: string[]): Promise<ObjectData> {
        console.log(`\n🎬 Stitching ${videoPaths.length} scenes (no audio)...`);

        const tmpDir = "/tmp";
        const fileListPath = path.join(tmpDir, "concat_list.txt");
        const finalVideoPath = path.join(tmpDir, "final_movie.mp4");
        const downloadedFiles: string[] = [];

        try {
            console.log("   ... Downloading video clips...");
            await Promise.all(videoPaths.map(async (pathUrl, i) => {
                const localPath = path.join(tmpDir, `clip_${i}.mp4`);
                await this.storageManager.downloadFile(pathUrl, localPath);
                downloadedFiles[ i ] = localPath; // Ensure order is preserved
            }));

            const fileListContent = downloadedFiles.map(f => `file \'${f}\'`).join("\n");
            fs.writeFileSync(fileListPath, fileListContent);

            console.log("   ... Stitching videos with ffmpeg (no audio)");
            await new Promise<void>((resolve, reject) => {
                ffmpeg()
                    .input(fileListPath)
                    .inputOptions([ "-f", "concat", "-safe", "0" ])
                    .outputOptions("-c copy")
                    .save(finalVideoPath)
                    .on("end", () => resolve())
                    .on("error", (err: Error) => reject(err));
            });

            const objectPath = await this.storageManager.getGcsObjectPath({ type: "stitched_video" });
            console.log(`   ... Uploading stitched video to ${objectPath}`);
            const gcsUri = await this.storageManager.uploadFile(finalVideoPath, objectPath);

            console.log(`   ✓ Rendered video uploaded: ${this.storageManager.getPublicUrl(gcsUri)}`);

            const video = this.storageManager.buildObjectData(gcsUri);
            return video;

        } catch (error) {
            console.error("   ✗ Failed to stitch scenes:", error);
            throw error;
        }
        finally {
            if (fs.existsSync(fileListPath)) fs.unlinkSync(fileListPath);
            if (fs.existsSync(finalVideoPath)) fs.unlinkSync(finalVideoPath);
            downloadedFiles.forEach(f => {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            });
        }
    }
}
