import { MediaController } from "../../shared/services/media-controller.js";
import { GCPStorageManager } from "../../shared/services/storage-manager.js";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";

// // Mock dependencies
// jest.mock("./storage-manager");
// jest.mock("fluent-ffmpeg");
// jest.mock("fs");

// describe("MediaController", () => {
//     let mediaController: MediaController;
//     let storageManagerMock: jest.Mocked<GCPStorageManager>;

//     beforeEach(() => {
//         storageManagerMock = new GCPStorageManager("project-id", "video-id", "bucket-name") as jest.Mocked<GCPStorageManager>;
//         mediaController = new MediaController(storageManagerMock);
//         jest.clearAllMocks();
//     });

//     it("should stitch scenes with audio", async () => {
//         const videoPaths = [ "gs://bucket/video1.mp4", "gs://bucket/video2.mp4" ];
//         const audioPath = "gs://bucket/audio.mp3";
//         const projectId = "project-1";
//         const attempt = 1;

//         // Mock storage manager methods
//         storageManagerMock.downloadFile.mockResolvedValue();
//         storageManagerMock.getObjectPath.mockReturnValue("final/movie.mp4");
//         storageManagerMock.uploadFile.mockResolvedValue("gs://bucket/final/movie.mp4");
//         storageManagerMock.buildObjectData.mockReturnValue({
//             storageUri: "gs://bucket/final/movie.mp4",
//             publicUri: "https://storage.googleapis.com/bucket/final/movie.mp4",
//             model: "",
//         });

//         // Mock ffmpeg
//         const ffmpegMock = {
//             input: jest.fn().mockReturnThis(),
//             inputOptions: jest.fn().mockReturnThis(),
//             outputOptions: jest.fn().mockReturnThis(),
//             save: jest.fn().mockImplementation((path: any, callback: any) => {
//                 if (callback) callback(null, "done");
//                 return Promise.resolve();
//             }),
//             on: jest.fn().mockImplementation(function (this: any, event: string, callback: any) {
//                 if (event === 'end') {
//                     callback();
//                 }
//                 return this;
//             }),
//         };
//         (ffmpeg as unknown as jest.Mock).mockReturnValue(ffmpegMock);

//         // Mock fs
//         (fs.writeFileSync as jest.Mock).mockImplementation(() => { });
//         (fs.existsSync as jest.Mock).mockReturnValue(true);
//         (fs.unlinkSync as jest.Mock).mockImplementation(() => { });

//         await mediaController.stitchScenes(videoPaths, projectId, attempt, audioPath);

//         expect(storageManagerMock.downloadFile).toHaveBeenCalledTimes(3); // 2 videos + 1 audio
//         expect(ffmpegMock.input).toHaveBeenCalledTimes(2); // intermediate and final
//         expect(fs.writeFileSync).toHaveBeenCalled();
//         expect(storageManagerMock.uploadFile).toHaveBeenCalled();
//         expect(fs.unlinkSync).toHaveBeenCalled();
//     });

//     it("should stitch scenes without audio", async () => {
//         const videoPaths = [ "gs://bucket/video1.mp4", "gs://bucket/video2.mp4" ];
//         const projectId = "project-1";
//         const attempt = 1;

//         storageManagerMock.downloadFile.mockResolvedValue();
//         storageManagerMock.getObjectPath.mockReturnValue("final/movie.mp4");
//         storageManagerMock.uploadFile.mockResolvedValue("gs://bucket/final/movie.mp4");
//         storageManagerMock.buildObjectData.mockReturnValue({
//             storageUri: "gs://bucket/final/movie.mp4",
//             publicUri: "https://storage.googleapis.com/bucket/final/movie.mp4",
//             model: "",
//         });

//         const ffmpegMock = {
//             input: jest.fn().mockReturnThis(),
//             inputOptions: jest.fn().mockReturnThis(),
//             outputOptions: jest.fn().mockReturnThis(),
//             save: jest.fn().mockImplementation((path: any, callback: any) => {
//                 if (callback) callback(null, "done");
//                 return Promise.resolve();
//             }),
//             on: jest.fn().mockImplementation(function (this: any, event: string, callback: any) {
//                 if (event === 'end') {
//                     callback();
//                 }
//                 return this;
//             }),
//         };
//         (ffmpeg as unknown as jest.Mock).mockReturnValue(ffmpegMock);

//         (fs.writeFileSync as jest.Mock).mockImplementation(() => { });
//         (fs.existsSync as jest.Mock).mockReturnValue(true);
//         (fs.unlinkSync as jest.Mock).mockImplementation(() => { });

//         await mediaController.stitchScenes(videoPaths, projectId, attempt, undefined);

//         expect(storageManagerMock.downloadFile).toHaveBeenCalledTimes(2); // 2 videos
//         expect(ffmpegMock.input).toHaveBeenCalledTimes(1);
//         expect(fs.writeFileSync).toHaveBeenCalled();
//         expect(storageManagerMock.uploadFile).toHaveBeenCalled();
//         expect(fs.unlinkSync).toHaveBeenCalled();
//     });

//     it("should handle ffmpeg errors", async () => {
//         const videoPaths = [ "gs://bucket/video1.mp4" ];
//         const projectId = "project-1";
//         const attempt = 1;

//         storageManagerMock.downloadFile.mockResolvedValue();

//         const ffmpegMock = {
//             input: jest.fn().mockReturnThis(),
//             inputOptions: jest.fn().mockReturnThis(),
//             outputOptions: jest.fn().mockReturnThis(),
//             save: jest.fn().mockImplementation((_path: any, callback: (err: any) => void) => {
//                 // DO NOTHING - let 'error' event handler trigger rejection
//             }),
//             on: jest.fn().mockImplementation(function (this: any, event: string, callback: (err?: Error) => void) {
//                 if (event === 'error') {
//                     callback(new Error("ffmpeg error"));
//                 }
//                 return this;
//             }),
//         };
//         (ffmpeg as unknown as jest.Mock).mockReturnValue(ffmpegMock);

//         // Mock fs
//         (fs.writeFileSync as jest.Mock).mockImplementation(() => { });
//         (fs.existsSync as jest.Mock).mockReturnValue(true);
//         (fs.unlinkSync as jest.Mock).mockImplementation(() => { });


//         await expect(mediaController.stitchScenes(videoPaths, projectId, attempt, undefined)).rejects.toThrow("ffmpeg error");

//         expect(fs.unlinkSync).toHaveBeenCalled();
//     });

//     it("should handle empty scene list", async () => {
//         // This functionality is actually in performIncrementalVideoRender, not stitchScenes
//         // But we can verify that stitchScenes behaves somewhat reasonably or throws if empty
//         const videoPaths: string[] = [];
//         const projectId = "project-1";
//         const attempt = 1;

//         // Based on implementation, it might try to download empty list and then ffmpeg might fail on empty file list
//         // Let's see what happens.
//         // Actually, looking at the code:
//         // downloadFiles loop will do nothing.
//         // fileListContent will be empty string (or newlines only if array has holes, but it's empty)
//         // ffmpeg will be called with empty file list.

//         // In performIncrementalVideoRender, it checks for length === 0 and returns undefined.
//         // So stitchScenes is likely never called with empty list in production flow.
//         // However, robust code might handle it.

//         // For now, let's just assert that it proceeds to try to stitch (and likely fail in ffmpeg mock if we don't handle it)
//         // We'll mock ffmpeg to succeed even with empty input for this test, or expect it to be called.

//         const ffmpegMock = {
//             input: jest.fn().mockReturnThis(),
//             inputOptions: jest.fn().mockReturnThis(),
//             outputOptions: jest.fn().mockReturnThis(),
//             save: jest.fn().mockImplementation((path: any, callback: any) => {
//                 if (callback) callback(null, "done");
//                 return Promise.resolve();
//             }),
//             on: jest.fn().mockImplementation(function (this: any, event: string, callback: any) {
//                 if (event === 'end') {
//                     callback();
//                 }
//                 return this;
//             }),
//         };
//         (ffmpeg as unknown as jest.Mock).mockReturnValue(ffmpegMock);

//         await mediaController.stitchScenes(videoPaths, projectId, attempt, undefined);
//         expect(ffmpegMock.input).toHaveBeenCalled();
//     });
// });
