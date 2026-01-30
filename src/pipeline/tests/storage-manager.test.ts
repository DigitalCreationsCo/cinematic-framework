import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GCPStorageManager } from '../../shared/services/storage-manager.js';

// Mock @google-cloud/storage
const mockFile = {
  save: vi.fn(),
  download: vi.fn(),
  exists: vi.fn().mockResolvedValue([ true ]),
  getMetadata: vi.fn().mockResolvedValue([ { contentType: 'video/mp4' } ]),
  name: 'test-file',
};

const mockBucket = {
  upload: vi.fn(),
  file: vi.fn(() => mockFile),
  getFiles: vi.fn(),
  exists: vi.fn().mockReturnValue([ true ]),
  iam: {
    testPermissions: vi.fn().mockResolvedValue([ { 'storage.objects.get': true, 'storage.objects.list': true } ]),
  },
};

const mockStorage = {
  bucket: vi.fn(() => mockBucket),
};

vi.mock('@google-cloud/storage', () => {
  class MockStorage {
    constructor() {
      return mockStorage;
    }
  }
  return { Storage: MockStorage };
});

describe('GCPStorageManager', () => {
  let storageManager: GCPStorageManager;
  const projectId = 'test-project';
  const videoId = 'test-video';
  const bucketName = 'test-bucket';

  beforeEach(() => {
    vi.clearAllMocks();
    storageManager = new GCPStorageManager(projectId, videoId, bucketName);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be initialized correctly', () => {
    expect(storageManager).toBeInstanceOf(GCPStorageManager);
  });

  describe('getObjectPath', () => {
    it('should generate correct paths for character_image', () => {
      expect(storageManager.getObjectPath({ type: 'character_image', characterId: 'char1', attempt: 1 }))
        .toBe('test-bucket/test-video/images/characters/char1_reference.png');
    });

    it('should generate correct paths for location_image', () => {
      expect(storageManager.getObjectPath({ type: 'location_image', locationId: 'loc1', attempt: 1 }))
        .toBe('test-bucket/test-video/images/locations/loc1_reference.png');
    });

    it('should generate correct paths for scene_start_frame with attempt', () => {
      expect(storageManager.getObjectPath({ type: 'scene_start_frame', sceneId: '1', attempt: 3 }))
        .toBe('test-bucket/test-video/images/frames/scene_001_frame_start_03.png');
    });

    it('should generate correct paths for scene_end_frame with attempt', () => {
      expect(storageManager.getObjectPath({ type: 'scene_end_frame', sceneId: '1', attempt: 3 }))
        .toBe('test-bucket/test-video/images/frames/scene_001_frame_end_03.png');
    });

    it('should generate correct paths for composite_frame with attempt', () => {
      expect(storageManager.getObjectPath({ type: 'composite_frame', sceneId: '1', attempt: 2 }))
        .toBe('test-bucket/test-video/images/frames/scene_001_composite_02.png');
    });

    it('should generate correct paths for scene_video with attempt', () => {
      expect(storageManager.getObjectPath({ type: 'scene_video', sceneId: '1', attempt: 1 }))
        .toBe('test-bucket/test-video/scenes/scene_001_01.mp4');
    });

    it('should generate correct paths for render_video', () => {
      expect(storageManager.getObjectPath({ type: 'render_video', projectId: 'proj', attempt: 1 }))
        .toBe('test-bucket/test-video/final/movie.mp4');
    });

    it('should generate correct paths for final_output', () => {
      expect(storageManager.getObjectPath({ type: 'final_output', projectId: 'proj', attempt: 1 }))
        .toBe('test-bucket/test-video/final/final_output.json');
    });

    it('should throw an error for unknown object type', () => {
      // @ts-expect-error
      expect(() => storageManager.getObjectPath({ type: 'unknown_type' })).toThrow('Unknown GCS object type: unknown_type');
    });
  });

  describe('getPublicUrl', () => {
    it('should return the correct public URL', () => {
      const path = 'test-bucket/test-video/final/movie.mp4';
      const expectedUrl = 'https://storage.googleapis.com/test-bucket/test-video/final/movie.mp4';
      expect(storageManager.getPublicUrl(path)).toBe(expectedUrl);
    });

    it('should handle gs:// URL input', () => {
      const url = storageManager.getPublicUrl('gs://test-bucket/test-video/file.mp4');
      expect(url).toBe('https://storage.googleapis.com/test-bucket/test-video/file.mp4');
    });

    it('should prepend bucket if missing', () => {
      const url = storageManager.getPublicUrl('test-video/file.mp4');
      expect(url).toBe('https://storage.googleapis.com/test-bucket/test-video/file.mp4');
    });
  });

  describe('getGcsUrl', () => {
    it('should return the correct GCS URL', () => {
      const path = 'test-bucket/test-video/final/movie.mp4';
      const expectedUrl = 'gs://test-bucket/test-video/final/movie.mp4';
      expect(storageManager.getGcsUrl(path)).toBe(expectedUrl);
    });
  });

  describe('uploadFile', () => {
    it('should call bucket.upload with the correct parameters', async () => {
      const localPath = '/tmp/test.txt';
      const destination = 'test/test.txt';
      await storageManager.uploadFile(localPath, destination);
      expect(mockStorage.bucket).toHaveBeenCalledWith(bucketName);
      expect(mockBucket.upload).toHaveBeenCalledWith(localPath, {
        destination: destination,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });
    });
  });

  describe('uploadBuffer', () => {
    it('should save buffer with correct content type', async () => {
      const buffer = Buffer.from('test content');
      const destination = 'test/file.txt';
      await storageManager.uploadBuffer(buffer, destination, 'text/plain');
      expect(mockBucket.file).toHaveBeenCalledWith(destination);
      expect(mockFile.save).toHaveBeenCalledWith(buffer, expect.objectContaining({
        contentType: 'text/plain',
      }));
    });
  });

  describe('uploadJSON', () => {
    it('should serialize and upload JSON data as Buffer', async () => {
      const data = { key: 'value' };
      const destination = 'test/data.json';
      await storageManager.uploadJSON(data, destination);
      expect(mockBucket.file).toHaveBeenCalledWith(destination);
      // uploadJSON converts to Buffer, so we check for Buffer content
      expect(mockFile.save).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          contentType: 'application/json',
        })
      );
    });
  });

  describe('downloadToBuffer', () => {
    it('should download file contents to buffer', async () => {
      const testBuffer = Buffer.from('test content');
      mockFile.download.mockResolvedValue([ testBuffer ]);

      const result = await storageManager.downloadToBuffer('test-bucket/test-video/file.txt');
      expect(result).toEqual(testBuffer);
    });
  });

  describe('fileExists', () => {
    it('should return true if file exists', async () => {
      mockFile.exists.mockResolvedValue([ true ]);
      const result = await storageManager.fileExists('test-bucket/test-video/file.txt');
      expect(result).toBe(true);
    });

    it('should return false if file does not exist', async () => {
      mockFile.exists.mockResolvedValue([ false ]);
      const result = await storageManager.fileExists('test-bucket/test-video/nonexistent.txt');
      expect(result).toBe(false);
    });
  });

  describe('getObjectMimeType', () => {
    it('should return content type from metadata', async () => {
      mockFile.getMetadata.mockResolvedValue([ { contentType: 'video/mp4' } ]);
      const result = await storageManager.getObjectMimeType('test-bucket/test-video/movie.mp4');
      expect(result).toBe('video/mp4');
    });
  });
});
