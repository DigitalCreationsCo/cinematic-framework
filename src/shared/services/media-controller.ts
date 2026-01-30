import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import ffmpegBin from "@ffmpeg-installer/ffmpeg";
import ffprobeBin from "@ffprobe-installer/ffprobe";
import { Scene } from "../types/index.js";
import { GCPStorageManager } from "./storage-manager.js";
ffmpeg.setFfmpegPath(ffmpegBin.path);
ffmpeg.setFfprobePath(ffprobeBin.path);


export class MediaController {

    private storageManager: GCPStorageManager;

    constructor(storageManager: GCPStorageManager) {
        this.storageManager = storageManager;
    }

    async performIncrementalVideoRender(
        scenes: Scene[],
        audioGcsUri: string | undefined,
        projectId: string,
        attempt: number,
    ) {

        const videoPaths = scenes
            .map(s => {
                const best = s.assets[ "scene_video" ]!.best;
                return s.assets[ "scene_video" ]!.versions[ best ].data;
            })
            .filter((url): url is string => !!url);
        if (videoPaths.length === 0) return undefined;

        try {
            return await this.stitchScenes(videoPaths, projectId, attempt, audioGcsUri);
        } catch (error) {
            console.warn({ error }, "Incremental rendering failed");
            return undefined;
        }
    }

    async stitchScenes(videoPaths: string[], projectId: string, attempt: number, audioPath?: string): Promise<string> {

        console.log({ numScenes: videoPaths.length, videoPaths, projectId, attempt }, `Stitching scenes`);
        let finalVideoPath: string | undefined;
        try {
            finalVideoPath = await this.executeRenderVideo(videoPaths, audioPath);
            const objectPath = await this.storageManager.getObjectPath({ type: "render_video", projectId, attempt });

            console.log({ objectPath, projectId, attempt }, `Uploading`);
            const gcsUri = await this.storageManager.uploadFile(finalVideoPath, objectPath);
            console.log({ projectId, attempt, uploaded: this.storageManager.getPublicUrl(gcsUri) });
            return gcsUri;
        } catch (error) {
            console.error({ error }, "Failed to stitch scenes");
            throw error;
        } finally {
            if (finalVideoPath && fs.existsSync(finalVideoPath)) {
                fs.unlinkSync(finalVideoPath);
            }
        }
    }

    private async executeRenderVideo(videoPaths: string[], audioPath?: string): Promise<string> {

        const tmpDir = "/tmp";
        const fileListPath = path.join(tmpDir, "concat_list.txt");
        const intermediateVideoPath = path.join(tmpDir, "intermediate_movie.mp4");
        const finalVideoPath = path.join(tmpDir, "final_movie.mp4");
        const downloadedFiles: string[] = [];
        const localAudioPath = path.join(tmpDir, "audio.mp3");
        try {
            console.log("Downloading clips.");
            await Promise.all(videoPaths.map(async (pathUrl, i) => {
                const localPath = path.join(tmpDir, `clip_${i}.mp4`);
                await this.storageManager.downloadFile(pathUrl, localPath);
                downloadedFiles[ i ] = localPath; // Ensure order is preserved
            }));
            const fileListContent = downloadedFiles.map(f => `file '${f}'`).join("\n");
            fs.writeFileSync(fileListPath, fileListContent);

            if (audioPath) {
                console.log("Downloading audio.");
                await this.storageManager.downloadFile(audioPath, localAudioPath);

                console.log("Stitching videos with ffmpeg.");
                await new Promise<void>((resolve, reject) => {
                    ffmpeg()
                        .input(fileListPath)
                        .inputOptions([ "-f", "concat", "-safe", "0" ])
                        .outputOptions("-c copy")
                        .save(intermediateVideoPath)
                        .on("end", () => resolve())
                        .on("error", (err: Error) => reject(err));
                });

                console.log("Adding audio track to the final video.");
                await new Promise<string>((resolve, reject) => {
                    ffmpeg()
                        .input(intermediateVideoPath)
                        .input(localAudioPath)
                        .outputOptions([ "-c:v", "copy", "-c:a", "aac", "-strict", "experimental" ])
                        .save(finalVideoPath)
                        .on("end", () => resolve(finalVideoPath))
                        .on("error", (err: Error) => reject(err));
                });
            } else {
                console.log("Stitching videos with ffmpeg (no audio).");
                await new Promise<void>((resolve, reject) => {
                    ffmpeg()
                        .input(fileListPath)
                        .inputOptions([ "-f", "concat", "-safe", "0" ])
                        .outputOptions("-c copy")
                        .save(finalVideoPath)
                        .on("end", () => resolve())
                        .on("error", (err: Error) => reject(err));
                });
            }
            return finalVideoPath;
        } finally {
            if (fs.existsSync(fileListPath)) fs.unlinkSync(fileListPath);
            if (audioPath) {
                if (fs.existsSync(intermediateVideoPath)) fs.unlinkSync(intermediateVideoPath);
                if (fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);
            }
            downloadedFiles.forEach(f => {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            });
        }
    }

    getAudioDuration(filePath: string): Promise<number> {
        const duration = new Promise((resolve, reject) => {
            this.ffprobe(filePath, (err: any, metadata: any) => {
                if (err) {
                    reject(err);
                } else {
                    const duration = metadata.format.duration;
                    resolve(duration || 0);
                }
            });
        }) as Promise<number>;
        console.log({ durationSeconds: duration }, "Audio duration (ffprobe)");
        return duration;
    }

    private ffprobe(filePath: string, callback: (err: any, metadata: any) => void): void {

        ffmpeg.ffprobe(filePath, callback);
    }
}
