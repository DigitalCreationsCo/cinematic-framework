import { WorkerService } from '../worker-service';
import { CompositionalAgent } from '../../workflow/agents/compositional-agent';
import { GCPStorageManager } from '../../workflow/storage-manager';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies with explicit factories
vi.mock('../pipeline/services/job-control-plane');

// Mock StorageManager factory
const mockUploadJSON = vi.fn();
vi.mock('../../workflow/storage-manager', () => {
    return {
        GCPStorageManager: vi.fn().mockImplementation(() => ({
            uploadJSON: mockUploadJSON
        }))
    };
});

vi.mock('../workflow/agents/audio-processing-agent');

// Mock CompositionalAgent factory with default spies we can access or override if needed
const mockExpandCreativePrompt = vi.fn();
vi.mock('../../workflow/agents/compositional-agent', () => {
    return {
        CompositionalAgent: vi.fn().mockImplementation(() => ({
            expandCreativePrompt: mockExpandCreativePrompt,
            generateStoryboardFromPrompt: vi.fn(),
            generateFullStoryboard: vi.fn()
        }))
    };
});

vi.mock('../workflow/agents/quality-check-agent');
vi.mock('../workflow/agents/semantic-expert-agent');
vi.mock('../workflow/agents/frame-composition-agent');
vi.mock('../workflow/agents/scene-generator');
vi.mock('../workflow/agents/continuity-manager');

describe('WorkerService', () => {
    let workerService: WorkerService;
    let mockJobControlPlane: any;
    let mockPublishJobEvent: any;
    const workerId = 'test-worker-id';
    const bucketName = 'test-bucket';

    beforeEach(() => {
        mockPublishJobEvent = vi.fn();
        mockJobControlPlane = {
            claimJob: vi.fn(),
            getJob: vi.fn(),
            updateJobState: vi.fn(),
        };

        // Reset our manual spies
        mockExpandCreativePrompt.mockReset();
        mockUploadJSON.mockReset();

        // Default behavior
        mockExpandCreativePrompt.mockResolvedValue('expanded foo');

        workerService = new WorkerService(
            workerId,
            bucketName,
            mockJobControlPlane,
            mockPublishJobEvent,
            vi.fn()
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should fail to claim job if already taken', async () => {
        mockJobControlPlane.claimJob.mockResolvedValue(false);
        await workerService.processJob('job-1');
        expect(mockJobControlPlane.claimJob).toHaveBeenCalledWith('job-1', workerId);
        expect(mockJobControlPlane.getJob).not.toHaveBeenCalled();
    });

    it('should fail if job not found after claim', async () => {
        mockJobControlPlane.claimJob.mockResolvedValue(true);
        mockJobControlPlane.getJob.mockResolvedValue(null);
        await workerService.processJob('job-1');
        expect(mockJobControlPlane.getJob).toHaveBeenCalledWith('job-1');
        expect(mockPublishJobEvent).not.toHaveBeenCalled();
    });

    it('should process EXPAND_CREATIVE_PROMPT job', async () => {
        mockJobControlPlane.claimJob.mockResolvedValue(true);
        mockJobControlPlane.getJob.mockResolvedValue({
            id: 'job-1',
            type: 'EXPAND_CREATIVE_PROMPT',
            projectId: 'owner-1',
            payload: { enhancedPrompt: 'foo' }
        });

        await workerService.processJob('job-1');

        expect(mockExpandCreativePrompt).toHaveBeenCalledWith('foo');
        expect(mockJobControlPlane.updateJobState).toHaveBeenCalledWith('job-1', 'COMPLETED', { expandedPrompt: 'expanded foo' });
        expect(mockPublishJobEvent).toHaveBeenCalledWith({ type: 'JOB_COMPLETED', jobId: 'job-1' });
    });

    it('should handle errors during processing', async () => {
        mockJobControlPlane.claimJob.mockResolvedValue(true);
        mockJobControlPlane.getJob.mockResolvedValue({
            id: 'job-1',
            type: 'EXPAND_CREATIVE_PROMPT',
            projectId: 'owner-1',
            payload: { enhancedPrompt: 'foo' }
        });

        mockExpandCreativePrompt.mockRejectedValue(new Error('Processing failed'));

        await workerService.processJob('job-1');

        expect(mockJobControlPlane.updateJobState).toHaveBeenCalledWith('job-1', 'FAILED', undefined, 'Processing failed');
        expect(mockPublishJobEvent).toHaveBeenCalledWith({ type: 'JOB_FAILED', jobId: 'job-1', error: 'Processing failed' });
    });

    it('should propagate claimJob errors (DB failure)', async () => {
        const error = new Error('DB Connection Failed');
        mockJobControlPlane.claimJob.mockRejectedValue(error);

        await expect(workerService.processJob('job-1')).rejects.toThrow('DB Connection Failed');

        expect(mockJobControlPlane.claimJob).toHaveBeenCalledWith('job-1', workerId);
        expect(mockJobControlPlane.getJob).not.toHaveBeenCalled();
        expect(mockJobControlPlane.updateJobState).not.toHaveBeenCalled();
    });
});
