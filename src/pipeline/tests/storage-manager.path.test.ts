import { GCPStorageManager } from '../../shared/services/storage-manager.js';
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
  iam: {
    testPermissions: vi.fn().mockResolvedValue([ { 'storage.objects.get': true, 'storage.objects.list': true } ]),
  },
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

  describe('getPublicUrl', () => {
    it('should return valid https url with bucket when path starts with bucket', () => {
      const url = manager.getPublicUrl(`${bucketName}/path/to/file.txt`);
      expect(url).toBe(`https://storage.googleapis.com/${bucketName}/path/to/file.txt`);
    });

    it('should prepend bucket when path is relative', () => {
      const url = manager.getPublicUrl('path/to/file.txt');
      expect(url).toBe(`https://storage.googleapis.com/${bucketName}/path/to/file.txt`);
    });

    it('should work with gs:// input', () => {
      const url = manager.getPublicUrl(`gs://${bucketName}/path/to/file.txt`);
      expect(url).toBe(`https://storage.googleapis.com/${bucketName}/path/to/file.txt`);
    });

    it('should be idempotent', () => {
      const url1 = manager.getPublicUrl(`${bucketName}/path/to/file.txt`);
      const url2 = manager.getPublicUrl(url1);
      expect(url2).toBe(url1);
    });
  });

  describe('getGcsUrl', () => {
    it('should return valid gs:// uri from full path', () => {
      const url = manager.getGcsUrl(`${bucketName}/path/to/file.txt`);
      expect(url).toBe(`gs://${bucketName}/path/to/file.txt`);
    });

    it('should return gs:// uri from relative path', () => {
      // Note: getGcsUrl does normalization but doesn't prepend bucket
      const url = manager.getGcsUrl('path/to/file.txt');
      expect(url).toBe('gs://path/to/file.txt');
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
