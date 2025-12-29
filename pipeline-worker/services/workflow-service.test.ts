import { WorkflowService } from './workflow-service';
import { CheckpointerManager } from '../../pipeline/checkpointer-manager';
import { CinematicVideoWorkflow } from '../../pipeline/graph';
import { streamWithInterruptHandling } from '../helpers/stream-helper';
import { GCPStorageManager } from '../../pipeline/storage-manager';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../pipeline/checkpointer-manager');
vi.mock('../pipeline/graph');
vi.mock('./helpers/stream-helper');
vi.mock('../pipeline/storage-manager');

describe('WorkflowService', () => {
    let workflowService: WorkflowService;
    let mockCheckpointerManager: any;
    let mockPublishEvent: any;
    let mockWorkflow: any;
    let mockCompiledGraph: any;

    const projectId = 'test-project';
    const gcpProjectId = 'test-gcp-project';
    const bucketName = 'test-bucket';

    beforeEach(() => {
        mockPublishEvent = vi.fn();

        // Setup CheckpointerManager mock
        mockCheckpointerManager = {
            getCheckpointer: vi.fn().mockResolvedValue({}),
            loadCheckpoint: vi.fn().mockResolvedValue(null)
        };

        // Setup Workflow mock
        mockCompiledGraph = {
            stream: vi.fn(),
        };
        mockWorkflow = {
            graph: {
                compile: vi.fn().mockReturnValue(mockCompiledGraph)
            },
            publishEvent: null
        };
        (CinematicVideoWorkflow as any).mockImplementation(function () { return mockWorkflow; });

        workflowService = new WorkflowService(
            mockCheckpointerManager,
            mockPublishEvent,
            gcpProjectId,
            bucketName
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('startPipeline', () => {
        it('should start a new pipeline when no checkpoint exists', async () => {
            const payload = { creativePrompt: 'test prompt' };
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue(null);

            await workflowService.startPipeline(projectId, payload);

            expect(mockCheckpointerManager.getCheckpointer).toHaveBeenCalled();
            expect(mockWorkflow.graph.compile).toHaveBeenCalled();
            expect(streamWithInterruptHandling).toHaveBeenCalledWith(
                projectId,
                mockCompiledGraph,
                expect.objectContaining({ creativePrompt: 'test prompt' }), // Initial state check
                expect.objectContaining({ configurable: { thread_id: projectId } }),
                'startPipeline',
                mockPublishEvent
            );
        });

        it('should resume pipeline and update state when checkpoint exists', async () => {
            const payload = { creativePrompt: 'test prompt' };
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({ channel_values: {} });

            await workflowService.startPipeline(projectId, payload);

            expect(streamWithInterruptHandling).toHaveBeenCalledWith(
                projectId,
                mockCompiledGraph,
                { creativePrompt: 'test prompt' },
                expect.objectContaining({ configurable: { thread_id: projectId } }),
                'startPipeline',
                mockPublishEvent
            );
        });

        it('should update audio details when resuming with new audio', async () => {
            const payload = { audioGcsUri: 'gs://bucket/test.mp3' };
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({ channel_values: {} });

            const mockGetPublicUrl = vi.fn().mockReturnValue('https://storage.googleapis.com/bucket/test.mp3');
            (GCPStorageManager as any).mockImplementation(() => ({
                getPublicUrl: mockGetPublicUrl,
            }));

            await workflowService.startPipeline(projectId, payload);

            expect(streamWithInterruptHandling).toHaveBeenCalledWith(
                projectId,
                mockCompiledGraph,
                expect.objectContaining({
                    audioGcsUri: 'gs://bucket/test.mp3',
                    localAudioPath: 'gs://bucket/test.mp3',
                    audioPublicUri: 'https://storage.googleapis.com/bucket/test.mp3',
                    hasAudio: true
                }),
                expect.objectContaining({ configurable: { thread_id: projectId } }),
                'startPipeline',
                mockPublishEvent
            );
        });
    });

    describe('resumePipeline', () => {
        it('should fail if no checkpoint exists', async () => {
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue(null);

            await workflowService.resumePipeline(projectId);

            expect(mockPublishEvent).toHaveBeenCalledWith(expect.objectContaining({
                type: 'WORKFLOW_FAILED'
            }));
            expect(streamWithInterruptHandling).not.toHaveBeenCalled();
        });

        it('should resume if checkpoint exists', async () => {
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({});

            await workflowService.resumePipeline(projectId);

            expect(streamWithInterruptHandling).toHaveBeenCalledWith(
                projectId,
                mockCompiledGraph,
                null,
                expect.objectContaining({ configurable: { thread_id: projectId } }),
                'resumePipeline',
                mockPublishEvent
            );
        });
    });
});
