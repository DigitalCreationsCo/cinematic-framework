
import { Storage } from "@google-cloud/storage";
import path from "path";
import { ObjectData } from "../shared/pipeline-types";

export type GcsObjectType =
  | 'storyboard'
  | 'final_output'
  | 'character_image'
  | 'location_image'
  | 'scene_video'
  | 'scene_start_frame'
  | 'scene_end_frame'
  | 'stitched_video'
  | 'composite_frame'
  | 'scene_quality_evaluation'
  | 'frame_quality_evaluation';

export type GcsObjectPathParams =
  | { type: 'storyboard'; }
  | { type: 'final_output'; }
  | { type: 'stitched_video'; }
  | { type: 'character_image'; characterId: string; }
  | { type: 'location_image'; locationId: string; }
  | { type: 'scene_video'; sceneId: number; attempt?: number | 'latest'; }
  | { type: 'scene_start_frame'; sceneId: number; attempt?: number | 'latest'; }
  | { type: 'scene_end_frame'; sceneId: number; attempt?: number | 'latest'; }
  | { type: 'composite_frame'; sceneId: number; attempt?: number | 'latest'; }
  | { type: 'scene_quality_evaluation'; sceneId: number; attempt?: number | 'latest'; }
  | { type: 'frame_quality_evaluation'; sceneId: number; framePosition: "start" | "end"; attempt?: number | 'latest'; };

// ============================================================================
// GCP STORAGE MANAGER
// ============================================================================

export class GCPStorageManager {
  private storage: Storage;
  private bucketName: string;
  private videoId: string;
  private latestAttempts: Map<string, number> = new Map();

  constructor(projectId: string, videoId: string, bucketName: string) {
    this.storage = new Storage({ projectId });
    this.bucketName = bucketName;
    this.videoId = videoId;
  }

  /**
   * Initializes the storage manager by querying GCS for existing files
   * and populating the in-memory attempt cache.
   */
  async initialize(): Promise<void> {
    console.log("   ... Initializing storage manager and syncing state from GCS...");

    // We need to scan for several types of versioned assets
    await this.syncLatestAttempts('scene_video', 'scenes', /scene_\d{3}_(\d{2})\.mp4$/);
    await this.syncLatestAttempts('scene_start_frame', 'images/frames', /scene_\d{3}_lastframe_(\d{2})\.png$/);
    await this.syncLatestAttempts('scene_end_frame', 'images/frames', /scene_\d{3}_lastframe_(\d{2})\.png$/);
    await this.syncLatestAttempts('composite_frame', 'images/frames', /scene_\d{3}_composite_(\d{2})\.png$/);
    // await this.syncLatestAttempts('frame_quality_evaluation', 'images/frames', /scene_\d{3}_evaluation_(\d{2})\.json$/);
    await this.syncLatestAttempts('scene_quality_evaluation', 'scenes', /scene_\d{3}_evaluation_(\d{2})\.json$/);
    console.log("   ... Storage state synced.");
  }

  /**
   * Helper to scan GCS prefix and update latestAttempts map
   */
  private async syncLatestAttempts(type: GcsObjectType, subDir: string, regex: RegExp) {
    const prefix = path.posix.join(this.videoId, subDir);
    try {
      const [ files ] = await this.storage.bucket(this.bucketName).getFiles({ prefix });

      for (const file of files) {
        const match = file.name.match(regex);
        if (match && match[ 1 ]) {
          // Extract sceneId from filename (assuming standard format scene_XXX_...)
          const sceneIdMatch = file.name.match(/scene_(\d{3})_/);
          if (sceneIdMatch && sceneIdMatch[ 1 ]) {
            const sceneId = parseInt(sceneIdMatch[ 1 ], 10);
            const attempt = parseInt(match[ 1 ], 10);

            const key = `${type}_${sceneId}`;
            const current = this.latestAttempts.get(key) || 0;
            if (attempt > current) {
              this.latestAttempts.set(key, attempt);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`   ⚠️ Failed to sync state for ${type}:`, error);
    }
  }

  /**
   * Records the latest attempt number for a given object type and sceneId.
   * Call this after successfully uploading a file.
   */
  setLatestAttempt(type: GcsObjectType, sceneId: number, attempt: number): void {
    const key = `${type}_${sceneId}`;
    const current = this.latestAttempts.get(key) || 0;
    if (attempt > current) {
      this.latestAttempts.set(key, attempt);
    }
  }

  /**
   * Retrieves the latest attempt number for a given object type and sceneId.
   * Returns 1 if no attempt has been recorded.
   */
  private getLatestAttempt(type: GcsObjectType, sceneId: number): number {
    const key = `${type}_${sceneId}`;
    return this.latestAttempts.get(key) || 1;
  }

  /**
   * Resolves the attempt number to use for file operations.
   * If attempt is 'latest' or undefined, returns the stored latest attempt.
   * If attempt is a number, returns that number.
   */
  private resolveAttempt(type: GcsObjectType, sceneId: number, attempt?: number | 'latest'): number {
    if (attempt === 'latest' || attempt === undefined) {
      return this.getLatestAttempt(type, sceneId);
    }
    return attempt;
  }

  /**
   * Generates a standardized relative GCS object path.
   * Structure: [videoId]/[category]/[filename]
   */
  getGcsObjectPath(params: GcsObjectPathParams): string {
    const basePath = this.videoId;

    switch (params.type) {
      case 'storyboard':
        return path.posix.join(basePath, 'scenes', 'storyboard.json');

      case 'character_image':
        return path.posix.join(basePath, 'images', 'characters', `${params.characterId}_reference.png`);

      case 'location_image':
        return path.posix.join(basePath, 'images', 'locations', `${params.locationId}_reference.png`);

      case 'scene_start_frame': {
        const attemptNum = this.resolveAttempt(params.type, params.sceneId, params.attempt);
        return path.posix.join(basePath, 'images', 'frames', `scene_${params.sceneId.toString().padStart(3, '0')}_frame_start_${attemptNum.toString().padStart(2, '0')}.png`);
      }

      case 'scene_end_frame': {
        const attemptNum = this.resolveAttempt(params.type, params.sceneId, params.attempt);
        return path.posix.join(basePath, 'images', 'frames', `scene_${params.sceneId.toString().padStart(3, '0')}_frame_end_${attemptNum.toString().padStart(2, '0')}.png`);
      }

      case 'frame_quality_evaluation': {
        const attemptNum = this.resolveAttempt(params.type, params.sceneId, params.attempt);
        return path.posix.join(basePath, 'images', 'frames', `scene_${params.sceneId.toString().padStart(3, '0')}_frame_${params.framePosition}_evaluation_${attemptNum.toString().padStart(2, '0')}.json`);
      }

      case 'composite_frame': {
        const attemptNum = this.resolveAttempt(params.type, params.sceneId, params.attempt);
        return path.posix.join(basePath, 'images', 'frames', `scene_${params.sceneId.toString().padStart(3, '0')}_composite_${attemptNum.toString().padStart(2, '0')}.png`);
      }

      case 'scene_video': {
        const attemptNum = this.resolveAttempt(params.type, params.sceneId, params.attempt);
        return path.posix.join(basePath, 'scenes', `scene_${params.sceneId.toString().padStart(3, '0')}_${attemptNum.toString().padStart(2, '0')}.mp4`);
      }

      case 'scene_quality_evaluation': {
        const attemptNum = this.resolveAttempt(params.type, params.sceneId, params.attempt);
        return path.posix.join(basePath, 'scenes', `scene_${params.sceneId.toString().padStart(3, '0')}_evaluation_${attemptNum.toString().padStart(2, '0')}.json`);
      }

      case 'stitched_video':
        return path.posix.join(basePath, 'final', 'movie.mp4');

      case 'final_output':
        return path.posix.join(basePath, 'final', 'final_output.json');

      default:
        throw new Error(`Unknown GCS object type: ${(params as any).type}`);
    }
  }

  async uploadFile(
    localPath: string,
    destination: string
  ): Promise<string> {
    const bucket = this.storage.bucket(this.bucketName);
    const normalizedDest = this.normalizePath(destination);

    await bucket.upload(localPath, {
      destination: normalizedDest,
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });
    return this.getGcsUrl(normalizedDest);
  }

  async uploadBuffer(
    buffer: Buffer,
    destination: string,
    contentType: string
  ): Promise<string> {
    const bucket = this.storage.bucket(this.bucketName);
    const normalizedDest = this.normalizePath(destination);
    const file = bucket.file(normalizedDest);

    await file.save(buffer, {
      contentType,
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });
    return this.getGcsUrl(normalizedDest);
  }

  async uploadJSON(data: any, destination: string): Promise<string> {
    const buffer = Buffer.from(JSON.stringify(data, null, 2));
    return this.uploadBuffer(buffer, destination, "application/json");
  }

  async uploadAudioFile(localPath: string): Promise<string> {
    const fileName = path.basename(localPath);
    const destination = `audio/${fileName}`;
    const gcsUri = this.getGcsUrl(destination);

    const exists = await this.fileExists(destination);
    if (exists) {
      console.log(`   ... Audio file already exists at ${gcsUri}, skipping upload.`);
      return gcsUri;
    }

    console.log(`   ... Uploading ${localPath} to GCS at ${destination}`);
    return this.uploadFile(localPath, destination);
  }

  async downloadJSON<T>(source: string): Promise<T> {
    const bucket = this.storage.bucket(this.bucketName);
    const path = this.parsePathFromUri(source);
    const file = bucket.file(path);
    const [ contents ] = await file.download();
    return JSON.parse(contents.toString()) as T;
  }

  private normalizePath(inputPath: string): string {
    let cleanPath = inputPath.replace(/^gs:\/\/[^\/]+\//, '');
    cleanPath = path.posix.normalize(cleanPath);
    if (cleanPath.startsWith('/')) {
      cleanPath = cleanPath.substring(1);
    }
    return cleanPath;
  }

  private parsePathFromUri(uriOrPath: string): string {
    return this.normalizePath(uriOrPath);
  }

  async downloadFile(gcsPath: string, localDestination: string): Promise<void> {
    const path = this.parsePathFromUri(gcsPath);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    await file.download({ destination: localDestination });
  }

  async downloadToBuffer(gcsPath: string): Promise<Buffer> {
    const path = this.parsePathFromUri(gcsPath);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    const [ contents ] = await file.download();
    return contents;
  }

  async fileExists(gcsPath: string): Promise<boolean> {
    const path = this.parsePathFromUri(gcsPath);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    const [ exists ] = await file.exists();
    return exists;
  }

  getPublicUrl(gcsPath: string): string {
    const normalizedPath = this.normalizePath(gcsPath);
    return `https://storage.googleapis.com/${this.bucketName}/${normalizedPath}`;
  }

  getGcsUrl(gcsPath: string): string {
    const normalizedPath = this.normalizePath(gcsPath);
    return `gs://${this.bucketName}/${normalizedPath}`;
  }

  buildObjectData(uri: string): ObjectData {
    return {
      storageUri: this.getGcsUrl(uri),
      publicUri: this.getPublicUrl(uri)
    };
  }
  async getObjectMimeType(gcsPath: string): Promise<string | undefined> {
    const path = this.parsePathFromUri(gcsPath);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    const [ metadata ] = await file.getMetadata();
    return metadata.contentType;
  }
}
