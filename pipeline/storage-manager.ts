
import { Storage } from "@google-cloud/storage";
import path from "path";
import { ObjectData } from "../shared/pipeline-types";

export type GcsObjectType =
  | 'state'
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
  | { type: 'state'; }
  | { type: 'storyboard'; }
  | { type: 'final_output'; }
  | { type: 'stitched_video'; }
  | { type: 'character_image'; characterId: string; }
  | { type: 'location_image'; locationId: string; }
  | { type: 'scene_video'; sceneId: number; attempt: number | 'latest'; }
  | { type: 'scene_start_frame'; sceneId: number; attempt: number | 'latest'; }
  | { type: 'scene_end_frame'; sceneId: number; attempt: number | 'latest'; }
  | { type: 'composite_frame'; sceneId: number; attempt: number | 'latest'; }
  | { type: 'scene_quality_evaluation'; sceneId: number; attempt: number | 'latest'; }
  | { type: 'frame_quality_evaluation'; sceneId: number; framePosition: "start" | "end"; attempt: number | 'latest'; };

// ============================================================================
// GCP STORAGE MANAGER
// ============================================================================

/**
 * Manages all Google Cloud Storage interactions for the pipeline.
 *
 * Responsibilities:
 * - Path Standardization: Generates consistent, versioned paths for all assets.
 * - Attempt Tracking: Manages version numbering (1, 2, 3...) for iterative assets.
 * - State Synchronization: Syncs local attempt state with GCS via `scanCurrentAttempts`.
 * - I/O Operations: Handles uploading and downloading of files, buffers, and JSON.
 */
export class GCPStorageManager {
  private storage: Storage;
  private bucketName: string;
  private videoId: string;
  private latestAttempts: Record<string, number> = {};
  private bestAttempts: Record<string, number> = {};

  /**
   * Creates an instance of GCPStorageManager.
   * @param projectId - Google Cloud Project ID.
   * @param videoId - Unique identifier for the current video project (used as root folder).
   * @param bucketName - Name of the GCS bucket to use.
   */
  constructor(projectId: string, videoId: string, bucketName: string) {
    this.storage = new Storage({ projectId });
    if (!this.storage.bucket(bucketName).exists()) {
      throw Error(`Bucket ${bucketName} does not exist!`);
    }

    this.bucketName = bucketName;
    this.videoId = videoId;

    const permissionsToCheck = [
      'storage.objects.get',
      'storage.objects.list'
    ];

    console.log(`Checking storage permissions: \n${permissionsToCheck.join(`,\n `)}`);

    this.storage.bucket(this.bucketName).iam.testPermissions(permissionsToCheck).then((res) => {
      const [ permissions ] = res;

      const hasAll = permissionsToCheck.every(p => permissions[ p ]);

      console.log('Permissions found:', permissions);

      if (hasAll) {
        console.log("✅ Credentials have all the specified permissions.");
      } else {
        console.log("❌ Credentials are missing one or more storage permissions.");
        throw Error(`Credentials are missing one or more storage permissions.`);
      }
    }, (err) => {
      console.error("Error checking permissions:", err);
      throw err;
    });
  }

  /**
   * Initializes the internal attempt trackers from a provided state (e.g., loaded from GraphState).
   * @param latest - Map of asset keys to their highest known attempt number.
   * @param best - Map of asset keys to their "best" or chosen attempt number.
   */
  initializeAttempts(latest: Record<string, number>, best: Record<string, number> = {}) {
    this.latestAttempts = { ...latest };
    this.bestAttempts = { ...best };
    console.log(`   ... StorageManager initialized with ${Object.keys(latest).length} latest attempts and ${Object.keys(best).length} best attempts.`);
  }

  /**
   * Registers a specific attempt as the "best" version for an asset.
   * Useful when picking a specific generation to use in the final video.
   */
  registerBestAttempt(type: GcsObjectType, id: number | string, attempt: number) {
    const key = `${type}_${id}`;
    this.bestAttempts[ key ] = attempt;
  }

  /**
   * Updates the latest known attempt for an asset if the provided attempt is higher.
   * Keeps track of the tip of the generation history.
   */
  updateLatestAttempt(type: GcsObjectType, id: number | string, attempt: number) {
    const key = `${type}_${id}`;
    if (!this.latestAttempts[ key ] || attempt > this.latestAttempts[ key ]) {
      this.latestAttempts[ key ] = attempt;
    }
  }

  /**
   * Retrieves the highest known attempt number for a given asset.
   * Returns 0 if no attempts are tracked.
   */
  getLatestAttempt(type: GcsObjectType, id: number | string): number {
    const key = `${type}_${id}`;
    return this.latestAttempts[ key ] || 0;
  }

  /**
   * Scans GCS for existing files and returns a map of the latest attempts.
   * This is used to initialize or validate the GraphState attempts map on startup.
   *
   * @returns A map of asset keys (e.g., 'scene_video_1') to their latest attempt numbers.
   */
  async scanCurrentAttempts(): Promise<Record<string, number>> {
    console.log("   ... Scanning GCS for existing assets to validate state...");
    const attempts: Record<string, number> = {};

    // Helper to update the local map
    const updateMap = (type: GcsObjectType, id: number, attempt: number) => {
      const key = `${type}_${id}`;
      if (!attempts[ key ] || attempt > attempts[ key ]) {
        attempts[ key ] = attempt;
      }
    };

    // We need to scan for several types of versioned assets
    await this.scanByType('scene_video', 'scenes', /scene_\d{3}_(\d{2})\.mp4$/, updateMap);
    await this.scanByType('scene_start_frame', 'images/frames', /scene_\d{3}_frame_start_(\d{2})\.png$/, updateMap);
    await this.scanByType('scene_end_frame', 'images/frames', /scene_\d{3}_frame_end_(\d{2})\.png$/, updateMap);
    await this.scanByType('composite_frame', 'images/frames', /scene_\d{3}_composite_(\d{2})\.png$/, updateMap);
    await this.scanByType('scene_quality_evaluation', 'scenes', /scene_\d{3}_evaluation_(\d{2})\.json$/, updateMap);

    console.log(`   ... Scan complete. Found ${Object.keys(attempts).length} tracked assets.`);
    return attempts;
  }

  /**
   * Helper to scan GCS prefix and update the provided map
   */
  private async scanByType(
    type: GcsObjectType,
    subDir: string,
    regex: RegExp,
    updateCallback: (type: GcsObjectType, id: number, attempt: number) => void
  ) {
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
            updateCallback(type, sceneId, attempt);
          }
        }
      }
    } catch (error) {
      console.warn(`   ⚠️ Failed to scan state for ${type}:`, error);
    }
  }

  /**
   * Generates a path for the NEXT attempt of a versioned asset.
   * Automatically increments the internal attempt counter and returns the new path.
   *
   * @param params - Path parameters (must include versioned type info).
   * @returns The relative GCS path for the new file (e.g., 'scenes/scene_001_02.mp4').
   */
  getNextAttemptPath(params: GcsObjectPathParams): string {
    if (!('sceneId' in params) || !('attempt' in params)) {
      // For non-versioned resources, just return the path
      return this.getGcsObjectPath(params);
    }

    const type = params.type;
    const id = params.sceneId;
    const nextAttempt = this.getNextAttempt(type, id);

    // Return path with explicit next attempt
    return this.getGcsObjectPath({ ...params, attempt: nextAttempt });
  }

  /**
   * Atomically increments and returns the next attempt number for an asset.
   */
  getNextAttempt(type: GcsObjectType, id: number | string): number {
    const key = `${type}_${id}`;
    const currentLatest = this.latestAttempts[ key ] || 0;
    const nextAttempt = currentLatest + 1;

    // Update internal state
    this.latestAttempts[ key ] = nextAttempt;
    return nextAttempt;
  }

  /**
   * Resolves the actual attempt number to use based on the input strategy.
   * - If explicit number: returns it directly.
   * - If 'latest': returns best > latest > 1.
   *
   * Defaults to 1 to ensure '00' files are never targeted implicitly.
   */
  private resolveAttempt(type: GcsObjectType, id: number, explicitAttempt: number | 'latest'): number {
    if (typeof explicitAttempt === 'number') return explicitAttempt;

    const key = `${type}_${id}`;

    // For 'latest', prefer best attempt if known (for reading)
    // This allows reading the "best" version when requesting latest, which is often what we want for playback
    if (this.bestAttempts[ key ] !== undefined) return this.bestAttempts[ key ];

    // Fallback to latest attempt
    if (this.latestAttempts[ key ] !== undefined) return this.latestAttempts[ key ];

    // Default to 1 to avoid creating "00" files if used for writing
    // If used for reading, checking for _01 is safer than _00
    return 1;
  }

  /**
   * Generates a standardized relative GCS object path.
   * Structure: [videoId]/[category]/[filename]
   *
   * @param params - Object describing the asset type and IDs.
   * @returns The relative path string (e.g., 'video_123/scenes/storyboard.json').
   */
  getGcsObjectPath(params: GcsObjectPathParams): string {
    // Always include bucket name to ensure full path validity for gs:// URIs
    const basePath = path.posix.join(this.bucketName, this.videoId);

    switch (params.type) {
      case 'state':
        return path.posix.join(basePath, 'state.json');

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

  /**
   * Uploads a local file to GCS.
   * @param localPath - Path to the file on the local filesystem.
   * @param destination - Relative destination path in GCS.
   * @returns The gs:// URI of the uploaded file.
   */
  async uploadFile(
    localPath: string,
    destination: string
  ): Promise<string> {
    const bucket = this.storage.bucket(this.bucketName);
    const normalizedDest = this.normalizePath(destination);
    const relativeDest = this.getBucketRelativePath(normalizedDest);

    await bucket.upload(localPath, {
      destination: relativeDest,
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });
    return this.getGcsUrl(normalizedDest);
  }

  /**
   * Uploads an in-memory buffer to GCS.
   * @param buffer - Data buffer to upload.
   * @param destination - Relative destination path in GCS.
   * @param contentType - MIME type of the content.
   * @returns The gs:// URI of the uploaded file.
   */
  async uploadBuffer(
    buffer: Buffer,
    destination: string,
    contentType: string
  ): Promise<string> {
    const bucket = this.storage.bucket(this.bucketName);
    const normalizedDest = this.normalizePath(destination);
    const relativeDest = this.getBucketRelativePath(normalizedDest);
    const file = bucket.file(relativeDest);

    await file.save(buffer, {
      contentType,
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });
    return this.getGcsUrl(normalizedDest);
  }

  /**
   * Uploads a JSON object to GCS.
   * @param data - The JSON object to serialize and upload.
   * @param destination - Relative destination path in GCS.
   * @returns The gs:// URI of the uploaded file.
   */
  async uploadJSON(data: any, destination: string): Promise<string> {
    const buffer = Buffer.from(JSON.stringify(data, null, 2));
    return this.uploadBuffer(buffer, destination, "application/json");
  }

  /**
   * Helper to upload a local audio file to the 'audio/' subdirectory.
   * Skips upload if the file already exists.
   * @param localPath - Path to the local audio file.
   * @returns The gs:// URI of the audio file.
   */
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

  /**
   * Downloads and parses a JSON file from GCS.
   * @param source - The GCS path or URI (gs://...) to download.
   * @returns The parsed JSON object of type T.
   */
  async downloadJSON<T>(source: string): Promise<T> {
    const bucket = this.storage.bucket(this.bucketName);
    const path = this.getBucketRelativePath(source);
    const file = bucket.file(path);
    const [ contents ] = await file.download();
    return JSON.parse(contents.toString()) as T;
  }

  private normalizePath(inputPath: string): string {
    let cleanPath = inputPath.replace(/^gs:\/\//, '');

    cleanPath = cleanPath.replace(/^https:\/\/storage\.googleapis\.com\//, '');

    cleanPath = path.posix.normalize(cleanPath);

    if (cleanPath.startsWith('/')) {
      cleanPath = cleanPath.substring(1);
    }

    return cleanPath;
  }

  private getBucketRelativePath(pathOrUri: string): string {
    const fullPath = this.normalizePath(pathOrUri);
    if (fullPath === this.bucketName) return '';

    // If path starts with bucket name, strip it to get the object name relative to bucket
    if (fullPath.startsWith(this.bucketName + '/')) {
      return fullPath.substring(this.bucketName.length + 1);
    }

    // If path doesn't start with bucket name, assume it's already relative (or from a different bucket, which we don't support here)
    // This is a safety fallback for legacy calls that might pass relative paths
    return fullPath;
  }

  /**
   * Downloads a file from GCS to a local destination path.
   */
  async downloadFile(gcsPath: string, localDestination: string): Promise<void> {
    const path = this.getBucketRelativePath(gcsPath);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    await file.download({ destination: localDestination });
  }

  /**
   * Downloads a file from GCS into memory.
   * @returns The file contents as a Buffer.
   */
  async downloadToBuffer(gcsPath: string): Promise<Buffer> {
    const path = this.getBucketRelativePath(gcsPath);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    const [ contents ] = await file.download();
    return contents;
  }

  /**
   * Checks if a file exists in GCS.
   * @param gcsPath - Relative path or gs:// URI.
   */
  async fileExists(gcsPath: string): Promise<boolean> {
    const path = this.getBucketRelativePath(gcsPath);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    const [ exists ] = await file.exists();
    return exists;
  }

  /**
   * Returns the HTTPS public URL for a GCS object.
   * Useful for frontend display.
   */
  getPublicUrl(path: string): string {
    const normalizedPath = this.normalizePath(path);
    return `https://storage.googleapis.com/${normalizedPath}`;
  }

  /**
   * Returns the gs:// URI for a GCS object.
   * Useful for backend/API operations.
   */
  getGcsUrl(path: string): string {
    const normalizedPath = this.normalizePath(path);
    return `gs://${normalizedPath}`;
  }

  /**
   * Constructs a standard ObjectData structure containing both public and storage URIs.
   */
  buildObjectData(uri: string, model: string): ObjectData {
    return {
      storageUri: this.getGcsUrl(uri),
      publicUri: this.getPublicUrl(uri),
      model: model
    };
  }

  /**
   * Retrieves the MIME type of a GCS object (e.g., 'video/mp4', 'image/png').
   */
  async getObjectMimeType(gcsPath: string): Promise<string | undefined> {
    const path = this.getBucketRelativePath(gcsPath);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    const [ metadata ] = await file.getMetadata();
    return metadata.contentType;
  }
}
