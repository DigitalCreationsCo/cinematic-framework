import { Storage } from "@google-cloud/storage";
import path from "path";
import { GcsObjectType } from "../types/index.js";



type ObjectPathParam<T extends GcsObjectType> = | {
  type: T;
};

type FinalOutputParam = ObjectPathParam<"final_output"> & { projectId: string; attempt: number; };
type CharacterImageParam = ObjectPathParam<"character_image"> & { characterId: string; attempt: number; };
type LocationImageParam = ObjectPathParam<"location_image"> & { locationId: string; attempt: number; };
type SceneVideoParam = ObjectPathParam<"scene_video"> & { sceneId: string; attempt: number; };
type SceneStartFrameParam = ObjectPathParam<"scene_start_frame"> & { sceneId: string; attempt: number; };
type SceneEndFrameParam = ObjectPathParam<"scene_end_frame"> & { sceneId: string; attempt: number; };
type RenderVideoParam = ObjectPathParam<"render_video"> & { projectId: string; attempt: number; };
type CompositeFrameParam = ObjectPathParam<"composite_frame"> & { sceneId: string; attempt: number; };

export type GcsObjectPathParams =
  | FinalOutputParam
  | CharacterImageParam
  | LocationImageParam
  | SceneVideoParam
  | SceneStartFrameParam
  | SceneEndFrameParam
  | RenderVideoParam
  | CompositeFrameParam;

/**
 * Manages all Google Cloud Storage interactions for the pipeline.
 *
 * Responsibilities:
 * - Path Standardization: Generates consistent paths for all assets.
 * - I/O Operations: Handles uploading and downloading of files, buffers, and JSON.
 * 
 * NOTE: Version tracking is now handled by AssetVersionManager. This class is stateless.
 */
export class GCPStorageManager {
  private storage: Storage;
  private bucketName: string;
  private videoId: string;

  constructor(gcpProjectId: string, videoId: string, bucketName: string) {
    this.storage = new Storage({ projectId: gcpProjectId });
    this.bucketName = bucketName;
    this.videoId = videoId;

    const permissionsToCheck = [
      'storage.objects.get',
      'storage.objects.list'
    ];

    console.log({ storagePermissionsToCheck: permissionsToCheck });

    this.storage.bucket(this.bucketName).iam.testPermissions(permissionsToCheck).then((res) => {
      const [ permissions ] = res;

      const hasAll = permissionsToCheck.every(p => permissions[ p ]);

      console.debug({ permissions });

      if (hasAll) {
        console.debug("✅ Credentials have the specified permissions.");
      } else {
        console.error("❌ Credentials are missing the specified permissions.");
        throw Error(`Credentials are missing the specified permissions.`);
      }
    }, (error) => {
      console.error({ error }, "Error checking permissions.");
      throw error;
    });
  }

  /**
   * Generates a standardized relative GCS object path.
   * Structure: [videoId]/[category]/[filename]
   */
  // TODO Add attempt params for new projects
  getObjectPath(params: GcsObjectPathParams): string {
    const basePath = path.posix.join(this.bucketName, this.videoId);

    switch (params.type) {
      case 'character_image':
        return path.posix.join(basePath, 'images', 'characters', `${params.characterId}_reference.png`);

      case 'location_image':
        return path.posix.join(basePath, 'images', 'locations', `${params.locationId}_reference.png`);

      case 'scene_start_frame':
        return path.posix.join(basePath, 'images', 'frames', `scene_${params.sceneId.toString().padStart(3, '0')}_frame_start_${params.attempt.toString().padStart(2, '0')}.png`);

      case 'scene_end_frame':
        return path.posix.join(basePath, 'images', 'frames', `scene_${params.sceneId.toString().padStart(3, '0')}_frame_end_${params.attempt.toString().padStart(2, '0')}.png`);

      case 'composite_frame':
        return path.posix.join(basePath, 'images', 'frames', `scene_${params.sceneId.toString().padStart(3, '0')}_composite_${params.attempt.toString().padStart(2, '0')}.png`);

      case 'scene_video':
        return path.posix.join(basePath, 'scenes', `scene_${params.sceneId.toString().padStart(3, '0')}_${params.attempt.toString().padStart(2, '0')}.mp4`);

      case 'render_video':
        return path.posix.join(basePath, 'final', `movie.mp4`);

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
  };

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
  };

  /**
   * Uploads a JSON object to GCS.
   * @param data - The JSON object to serialize and upload.
   * @param destination - Relative destination path in GCS.
   * @returns The gs:// URI of the uploaded file.
   */
  async uploadJSON(data: any, destination: string): Promise<string> {
    const buffer = Buffer.from(JSON.stringify(data, null, 2));
    return this.uploadBuffer(buffer, destination, "application/json");
  };

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
      console.log({ gcsUri }, `Audio file already exists. Skipping upload.`);
      return gcsUri;
    }

    console.log({ localPath, destination }, `Uploading to GCS.`);
    return this.uploadFile(localPath, destination);
  };

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
    if (fullPath.startsWith(this.bucketName + '/')) {
      return fullPath.substring(this.bucketName.length + 1);
    }
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
  };

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
  };

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
  };

  /**
   * Returns the HTTPS public URL for a GCS object.
   * Useful for frontend display.
   */
  getPublicUrl(pathOrUri: string): string {
    let cleanPath = pathOrUri.replace(/^gs:\/\//, '');
    cleanPath = cleanPath.replace(/^https:\/\/storage\.googleapis\.com\//, '');

    // Ensure no leading slashes
    while (cleanPath.startsWith('/')) {
      cleanPath = cleanPath.substring(1);
    }

    // Heuristic: If the path doesn't start with the bucket name, prepend it.
    // This is safe because all assets handled by this manager are within 'this.bucketName'.
    if (!cleanPath.startsWith(this.bucketName + '/')) {
      cleanPath = `${this.bucketName}/${cleanPath}`;
    }

    return `https://storage.googleapis.com/${cleanPath}`;
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
   * Retrieves the MIME type of a GCS object (e.g., 'video/mp4', 'image/png').
   */
  async getObjectMimeType(gcsPath: string): Promise<string | undefined> {
    const path = this.getBucketRelativePath(gcsPath);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    const [ metadata ] = await file.getMetadata();
    return metadata.contentType;
  };
}
