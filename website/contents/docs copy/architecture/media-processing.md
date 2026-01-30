# Media Processing Architecture

This document outlines the technical architecture of the `MediaController` class, which is responsible for stitching video scenes together, with or without audio.

## `MediaController` Class

The `MediaController` class orchestrates the process of combining individual video clips into a final rendered movie. It interacts with `GCPStorageManager` to download source files and upload the final output.

### Key Responsibilities

*   **Incremental Rendering**: The `performIncrementalVideoRender` function serves as the entry point for stitching scenes. It takes a list of scenes, a project ID, and an attempt number, and determines whether to include an audio track based on the `audioGcsUri` parameter.
*   **Scene Stitching**: The `stitchScenes` function manages the overall stitching process. It calls `executeRenderVideo` to perform the rendering and then uploads the result to cloud storage. It also ensures that temporary files are cleaned up after the process is complete.
*   **Video Rendering**: The `executeRenderVideo` function is the core of the rendering logic. It handles both audio and video stitching by using the `ffmpeg` library to concatenate video files and, if an audio track is provided, merges it with the video.

## Stitching Process Flow

1.  **Download Files**: `executeRenderVideo` begins by downloading all video clips and the optional audio track from cloud storage to a temporary local directory.
2.  **Create Concat List**: A text file (`concat_list.txt`) is generated, listing all the video files to be concatenated.
3.  **Execute `ffmpeg`**:
    *   **Without Audio**: If no audio track is provided, `ffmpeg` is called once to concatenate the video files listed in `concat_list.txt`.
    *   **With Audio**: If an audio track is present, `ffmpeg` is first used to create an intermediate video without audio. Then, a second `ffmpeg` command merges the intermediate video with the audio track.
4.  **Upload and Cleanup**: The final rendered video is returned to `stitchScenes`, which uploads it to cloud storage. All temporary files, including the downloaded clips, intermediate video, and the final rendered video, are then deleted from the local filesystem.

## Error Handling

The stitching process is wrapped in a `try...catch` block to handle any errors that may occur during file I/O or `ffmpeg` execution. If an error is caught, it is logged, and the function throws the error to be handled by the caller. The `finally` block in `stitchScenes` ensures that cleanup of the final video file is attempted regardless of success or failure.