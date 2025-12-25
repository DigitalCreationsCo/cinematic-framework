
import { GCPStorageManager } from './storage-manager';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// Mock the Google Cloud Storage library
const mockFile = {
  save: vi.fn().mockResolvedValue(undefined),
  download: vi.fn().mockResolvedValue([ Buffer.from('{}') ]),
  exists: vi.fn().mockResolvedValue([ false ]),
  getMetadata: vi.fn().mockResolvedValue([ { contentType: 'application/json' } ]),
};

const mockBucket = {
  file: vi.fn().mockReturnValue(mockFile),
  upload: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockReturnValue([ true ]),
};

const mockStorage = {
  bucket: vi.fn().mockReturnValue(mockBucket),
};

vi.mock('@google-cloud/storage', () => {
  return {
    Storage: class {
      constructor() {
        return mockStorage;
      }
    }
  };
});

describe('GCPStorageManager Path Consistency', () => {
  let manager: GCPStorageManager;
  const projectId = 'test-project';
  const videoId = 'video_123';
  const bucketName = 'test-bucket';

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new GCPStorageManager(projectId, videoId, bucketName);
  });

  afterEach(() => {
    // Clean up any temp files if created
    if (fs.existsSync('latest_attempts.json')) {
      fs.unlinkSync('latest_attempts.json');
    }
  });

  describe('normalizePath', () => {
    it('should correctly strip gs:// prefix and preserve bucket', () => {
      // @ts-ignore - accessing private method for testing
      const result = manager[ 'normalizePath' ](`gs://${bucketName}/path/to/file.txt`);
      expect(result).toBe(`${bucketName}/path/to/file.txt`);
    });

    it('should correctly strip https://storage.googleapis.com/ prefix and preserve bucket', () => {
      // @ts-ignore
      const result = manager[ 'normalizePath' ](`https://storage.googleapis.com/${bucketName}/path/to/file.txt`);
      expect(result).toBe(`${bucketName}/path/to/file.txt`);
    });

    it('should prepend bucket if missing from relative path', () => {
      // @ts-ignore
      const result = manager[ 'normalizePath' ]('path/to/file.txt');
      expect(result).toBe(`${bucketName}/path/to/file.txt`);
    });

    it('should not prepend bucket if already present', () => {
      // @ts-ignore
      const result = manager[ 'normalizePath' ](`${bucketName}/path/to/file.txt`);
      expect(result).toBe(`${bucketName}/path/to/file.txt`);
    });

    it('should normalize slashes and remove duplicates', () => {
      // @ts-ignore
      const result = manager[ 'normalizePath' ](`gs://${bucketName}//path//to//file.txt`);
      expect(result).toBe(`${bucketName}/path/to/file.txt`);
    });

    it('should be idempotent', () => {
      const path = `gs://${bucketName}/path/to/file.txt`;
      // @ts-ignore
      const first = manager[ 'normalizePath' ](path);
      // @ts-ignore
      const second = manager[ 'normalizePath' ](first);
      expect(second).toBe(first);
    });
  });

  describe('getPublicUrl', () => {
    it('should return valid https url with bucket', () => {
      const url = manager.getPublicUrl('path/to/file.txt');
      expect(url).toBe(`https://storage.googleapis.com/${bucketName}/path/to/file.txt`);
    });

    it('should work with gs:// input', () => {
      const url = manager.getPublicUrl(`gs://${bucketName}/path/to/file.txt`);
      expect(url).toBe(`https://storage.googleapis.com/${bucketName}/path/to/file.txt`);
    });

    it('should be idempotent', () => {
      const url1 = manager.getPublicUrl('path/to/file.txt');
      const url2 = manager.getPublicUrl(url1);
      expect(url2).toBe(url1);
    });
  });

  describe('getGcsUrl', () => {
    it('should return valid gs:// uri with bucket', () => {
      const url = manager.getGcsUrl('path/to/file.txt');
      expect(url).toBe(`gs://${bucketName}/path/to/file.txt`);
    });

    it('should work with https input', () => {
      const url = manager.getGcsUrl(`https://storage.googleapis.com/${bucketName}/path/to/file.txt`);
      expect(url).toBe(`gs://${bucketName}/path/to/file.txt`);
    });
  });

  describe('Internal storage operations', () => {
    // These tests ensure that when we actually call GCS, we strip the bucket name from the path
    // because bucket.file('path') expects path relative to bucket root.

    it('uploadFile should use bucket-relative path', async () => {
      await manager.uploadFile('local.txt', 'path/to/file.txt');
      expect(mockBucket.upload).toHaveBeenCalledWith('local.txt', expect.objectContaining({
        destination: 'path/to/file.txt'
      }));
    });

    it('downloadFile should use bucket-relative path', async () => {
      await manager.downloadFile(`gs://${bucketName}/path/to/file.txt`, 'local.txt');
      expect(mockBucket.file).toHaveBeenCalledWith('path/to/file.txt');
    });

    it('fileExists should use bucket-relative path', async () => {
      await manager.fileExists(`gs://${bucketName}/path/to/file.txt`);
      expect(mockBucket.file).toHaveBeenCalledWith('path/to/file.txt');
    });
  });
});
