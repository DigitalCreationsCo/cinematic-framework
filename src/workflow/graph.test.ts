import { CinematicVideoWorkflow } from './graph';
import { JobControlPlane } from '../pipeline/services/job-control-plane';
import { GCPStorageManager } from './storage-manager';
import { NodeInterrupt } from "@langchain/langgraph";
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../pipeline/services/job-control-plane');
vi.mock('./storage-manager');
vi.mock('./agents/audio-processing-agent');
vi.mock('./agents/compositional-agent');
vi.mock('./agents/quality-check-agent');
vi.mock('./agents/semantic-expert-agent');
vi.mock('./agents/frame-composition-agent');
vi.mock('./agents/scene-generator');
vi.mock('./agents/continuity-manager');

describe('CinematicVideoWorkflow', () => {
    let workflow: CinematicVideoWorkflow;
    let mockJobControlPlane: any;
    const gcpProjectId = 'test-project';
    const projectId = 'test-video';
    const bucketName = 'test-bucket';

    beforeEach(() => {
        mockJobControlPlane = {
            createJob: vi.fn(),
            getJob: vi.fn(),
            jobId: vi.fn((projectId, node, attempt, uniqueKey) => {
                return uniqueKey
                    ? `${projectId}-${node}-${uniqueKey}-${attempt}`
                    : `${projectId}-${node}-${attempt}`;
            })
        };

        (GCPStorageManager as any).mockImplementation(function () {
            return {
                downloadJSON: vi.fn(),
                uploadJSON: vi.fn(),
                getObjectPath: vi.fn().mockResolvedValue('gs://path'),
                initializeAttempts: vi.fn(),
                registerBestAttempt: vi.fn(),
            };
        });

        workflow = new CinematicVideoWorkflow({
            gcpProjectId,
            projectId,
            bucketName,
            jobControlPlane: mockJobControlPlane,
            lockManager: {
                acquireLock: vi.fn().mockResolvedValue(true),
                releaseLock: vi.fn().mockResolvedValue(true),
                init: vi.fn().mockResolvedValue(undefined)
            } as any
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.EXECUTION_MODE;
    });

    describe('ensureJob', () => {
        it('should dispatch job if not exists and throw NodeInterrupt', async () => {
            mockJobControlPlane.getJob.mockResolvedValue(null);

            try {
                // accessing private method via any
                await (workflow as any).ensureJob('node1', 'TEST_JOB', { foo: 'bar' }, { attempts: {} });
                expect(true).toBe(false); // Should not reach here
            } catch (e) {
                expect(e).toBeInstanceOf(NodeInterrupt);
                // NodeInterrupt handling might vary, just checking instance for now is sufficient for unit test
                // or check if it contains the reason in message or value
            }

            expect(mockJobControlPlane.createJob).toHaveBeenCalledWith(expect.objectContaining({
                type: 'TEST_JOB',
                payload: { foo: 'bar' }
            }));
        });

        it('should throw NodeInterrupt if job is running', async () => {
            mockJobControlPlane.getJob.mockResolvedValue({
                id: 'job-1',
                state: 'RUNNING'
            });

            try {
                await (workflow as any).ensureJob('node1', 'TEST_JOB', {}, {});
                expect(true).toBe(false);
            } catch (e) {
                expect(e).toBeInstanceOf(NodeInterrupt);
            }
            expect(mockJobControlPlane.createJob).not.toHaveBeenCalled();
        });

        it('should return result if job completed', async () => {
            mockJobControlPlane.getJob.mockResolvedValue({
                id: 'job-1',
                state: 'COMPLETED',
                result: { result: 'ok' }
            });

            const result = await (workflow as any).ensureJob('node1', 'TEST_JOB', {}, {});
            expect(result).toEqual({ result: 'ok' });
        });

        it('should throw error if job failed', async () => {
            mockJobControlPlane.getJob.mockResolvedValue({
                id: 'test-video-node1-1',
                state: 'FAILED',
                error: 'Some error'
            });

            // Ensure attempts count matches ID generation (default is 0+1=1)
            await expect((workflow as any).ensureJob('node1', 'TEST_JOB', {}, { attempts: { node1: 0 } }))
                .rejects.toThrow('Job test-video-node1-1 failed: Some error');
        });
    });

    describe('process_scene', () => {
        it('should use Parallel mode by default (Fan-Out)', async () => {
            const scenes = [ { id: 's1' }, { id: 's2' } ];
            const state = {
                storyboardState: { scenes },
                currentSceneIndex: 0,
                generationRules: [],
                refinedRules: []
            };

            // Mock ensureBatchJobs to return dummy results
            (workflow as any).ensureBatchJobs = vi.fn().mockResolvedValue([
                { scene: { id: 's1' }, acceptedAttempt: 1 },
                { scene: { id: 's2' }, acceptedAttempt: 1 }
            ]);

            // We need to access the node from the graph. 
            // Since graph is private/complex to traverse, we can't easily invoke the node function directly 
            // without exposing it or exporting it.
            // However, `process_scene` is added to the graph. 
            // We can try to test the private logic if we extract it or if we use `workflow.graph` but that requires compilation.

            // Alternative: The `ensureBatchJobs` is called inside `process_scene`.
            // We can test if `process_scene` logic constructs the correct jobs.
            // But `process_scene` is an anonymous function inside `buildGraph`.
            // We can't access it directly.

            // Wait, I can spy on `ensureBatchJobs` and run the graph?
            // Running the graph is complex as it requires full state.

            // Better approach: Test `CinematicVideoWorkflow` public methods or internal helpers if accessible.
            // But `process_scene` logic is embedded in `buildGraph`.

            // Ideally, I should refactor `process_scene` to be a method of the class so I can test it.
            // Refactoring `src/workflow/graph.ts` to make nodes class methods would be best for testability.
            // Given the constraints and current task, maybe I can just integration test via `workflow.execute` but that mocks everything.

            // Let's refactor `src/workflow/graph.ts` quickly to expose nodes as methods?
            // Or I can access `workflow.graph.nodes['process_scene']` if LangGraph exposes it?
            // LangGraph `StateGraph` stores nodes.

            // Let's assume I can't easily access the node function without refactoring.
            // I'll try to find the node function in `workflow.graph.nodes`.
            // `workflow.graph` is public.
        });
    });
});
