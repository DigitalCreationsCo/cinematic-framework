import { WorkflowOperator } from '../workflow-service.js';
import { CheckpointerManager } from '../checkpointer-manager.js';
import { CinematicVideoWorkflow } from '../graph.js';
import { streamWithInterruptHandling } from '../helpers/stream-helper.js';
import { GCPStorageManager } from '../../shared/services/storage-manager.js';
import { JobControlPlane } from '../../shared/services/job-control-plane.js';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from "@langchain/langgraph";
import { Scene } from '../../shared/types/index.js';
import { handleJobCompletion } from "../handlers/handleJobCompletion.js";

// Mock dependencies
vi.mock('../../workflow/checkpointer-manager');
vi.mock('../../workflow/graph');
vi.mock('../helpers/stream-helper');
vi.mock('../../workflow/storage-manager');
vi.mock('./job-control-plane');
vi.mock("../../workflow/asset-version-manager", () => {
    return {
        AssetVersionManager: vi.fn().mockImplementation(() => {
            return {
                setBestVersion: vi.fn().mockResolvedValue(undefined),
                getNextVersionNumber: vi.fn().mockResolvedValue([ 1 ]),
            };
        })
    };
});

describe('WorkflowOperator', () => {
    let workflowOperator: WorkflowOperator;
    let mockCheckpointerManager: any;
    let mockPublishEvent: any;
    let mockControlPlane: any;
    let mockProjectRepository: any;
    let mockWorkflow: any;
    let mockCompiledGraph: any;

    const projectId = 'test-project';
    const gcpProjectId = 'test-gcp-project';
    const bucketName = 'test-bucket';

    beforeEach(() => {
        mockPublishEvent = vi.fn();

        // Setup CheckpointerManager mock
        mockCheckpointerManager = {
            getCheckpointer: vi.fn().mockResolvedValue({
                put: vi.fn().mockResolvedValue(undefined)
            }),
            loadCheckpoint: vi.fn().mockResolvedValue(null)
        };

        // Setup ControlPlane mock
        mockControlPlane = {
            createJob: vi.fn(),
            getJob: vi.fn(),
            updateJobState: vi.fn()
        };

        // Setup ProjectRepository mock
        mockProjectRepository = {
            getScene: vi.fn(),
            getProjectScenes: vi.fn(),
            getProjectCharacters: vi.fn(),
            getProjectLocations: vi.fn(),
            getProject: vi.fn(),
            updateScenes: vi.fn(),
            updateSceneStatus: vi.fn()
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

        workflowOperator = new WorkflowOperator(
            mockCheckpointerManager,
            mockControlPlane,
            mockPublishEvent,
            mockProjectRepository,
            {} as any,
            gcpProjectId,
            bucketName
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('startPipeline', () => {
        it('should start a new pipeline when no checkpoint exists', async () => {
            const payload = { initialPrompt: 'test prompt' };
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue(null);

            await workflowOperator.startPipeline(projectId, payload);

            expect(mockCheckpointerManager.getCheckpointer).toHaveBeenCalled();
            expect(mockWorkflow.graph.compile).toHaveBeenCalled();
            expect(streamWithInterruptHandling).toHaveBeenCalledWith(
                projectId,
                mockCompiledGraph,
                expect.objectContaining({ enhancedPrompt: 'test prompt' }), // Initial state check
                expect.objectContaining({ configurable: { thread_id: projectId } }),
                'startPipeline',
                mockPublishEvent
            );
        });

        it('should resume pipeline and update state when checkpoint exists', async () => {
            const payload = { initialPrompt: 'test prompt' };
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({ channel_values: {} });

            await workflowOperator.startPipeline(projectId, payload);

            expect(streamWithInterruptHandling).toHaveBeenCalledWith(
                projectId,
                mockCompiledGraph,
                { enhancedPrompt: 'test prompt' },
                expect.objectContaining({ configurable: { thread_id: projectId } }),
                'startPipeline',
                mockPublishEvent
            );
        });

        it('should update audio details when resuming with new audio', async () => {
            const payload = { audioGcsUri: 'gs://bucket/test.mp3', initialPrompt: 'test prompt' };
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({ channel_values: {} });

            const mockGetPublicUrl = vi.fn().mockReturnValue('https://storage.googleapis.com/bucket/test.mp3');
            // Mock the constructor return value
            (GCPStorageManager as any).mockReturnValue({
                getPublicUrl: mockGetPublicUrl,
                getObjectPath: vi.fn().mockResolvedValue('path/to/object'),
                uploadJSON: vi.fn(),
                scanCurrentAttempts: vi.fn().mockResolvedValue({})
            });

            await workflowOperator.startPipeline(projectId, payload);

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

            await workflowOperator.resumePipeline(projectId);

            expect(mockPublishEvent).toHaveBeenCalledWith(expect.objectContaining({
                type: 'WORKFLOW_FAILED'
            }));
            expect(streamWithInterruptHandling).not.toHaveBeenCalled();
        });

        it('should resume if checkpoint exists', async () => {
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({});

            await workflowOperator.resumePipeline(projectId);

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

    describe('regenerateScene', () => {
        it('should trigger regenerate scene via Command', async () => {
            const sceneId = 'scene-1';
            const promptModification = 'make it darker';
            const forceRegenerate = true;

            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({
                channel_values: {
                    storyboardState: {
                        scenes: [ { id: sceneId } ]
                    },
                    scenePromptOverrides: {}
                }
            });

            await workflowOperator.regenerateScene(projectId, { sceneId, forceRegenerate, promptModification });

            expect(streamWithInterruptHandling).toHaveBeenCalledWith(
                projectId,
                mockCompiledGraph,
                expect.any(Command),
                expect.objectContaining({ configurable: { thread_id: projectId } }),
                'regenerateScene',
                mockPublishEvent
            );
        });

        it('should warn if checkpoint or scene not found', async () => {
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue(null);
            const promptModification = 'make it darker';
            const forceRegenerate = true;
            await workflowOperator.regenerateScene(projectId, { sceneId: 'missing', forceRegenerate, promptModification });
            expect(streamWithInterruptHandling).not.toHaveBeenCalled();
        });
    });

    describe('resolveIntervention', () => {
        it('should handle abort action', async () => {
            const interrupt = { nodeName: 'some_node', error: 'some error' };
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({
                channel_values: {
                    __interrupt__: [ { value: interrupt } ],
                    errors: []
                }
            });

            await workflowOperator.resolveIntervention(projectId, { action: 'abort' });

            expect(mockPublishEvent).toHaveBeenCalledWith(expect.objectContaining({
                type: 'WORKFLOW_FAILED',
                payload: expect.objectContaining({ error: 'Workflow canceled' })
            }));
        });

        it('should handle continue/retry action', async () => {
            const interrupt = { nodeName: 'some_node', params: { foo: 'bar' } };
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({
                channel_values: {
                    __interrupt__: [ { value: interrupt } ]
                }
            });

            await workflowOperator.resolveIntervention(projectId, { action: 'retry', revisedParams: { foo: 'baz' } });

            expect(streamWithInterruptHandling).toHaveBeenCalledWith(
                projectId,
                mockCompiledGraph,
                expect.any(Command),
                expect.objectContaining({ configurable: { thread_id: projectId } }),
                'resolveIntervention',
                mockPublishEvent
            );
        });
    });

    describe('updateSceneAsset', () => {
        it('should update scene asset and save checkpoint', async () => {
            const sceneId = 'scene-1';
            const mockScene = { id: sceneId, rejectedAttempts: {} } as unknown as Scene;

            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({
                channel_values: {
                    storyboardState: {
                        scenes: [ mockScene ]
                    }
                }
            });

            const mockgetObjectPath = vi.fn().mockReturnValue('path/to/asset');
            (GCPStorageManager as any).mockReturnValue({
                getObjectPath: mockgetObjectPath,
            });

            mockProjectRepository.getScene.mockResolvedValue(mockScene);

            await workflowOperator.updateSceneAsset(projectId, { scene: mockScene, assetKey: 'scene_video', version: 2 });

            const checkpointer = await mockCheckpointerManager.getCheckpointer();
            expect(checkpointer.put).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    channel_values: expect.objectContaining({
                        storyboardState: expect.objectContaining({
                            scenes: expect.arrayContaining([
                                expect.objectContaining({
                                    generatedVideo: expect.stringContaining('gs://path')
                                })
                            ])
                        })
                    })
                }),
                expect.anything(),
                expect.anything()
            );
            expect(mockPublishEvent).toHaveBeenCalledWith(expect.objectContaining({
                type: 'FULL_STATE'
            }));
        });
    });

    describe('handleJobCompletion', () => {
        it('should resume pipeline for normal jobs', async () => {
            mockControlPlane.getJob.mockResolvedValue({
                id: 'job-1',
                type: 'GENERATE_SCENE_VIDEO',
                state: 'COMPLETED',
                projectId: projectId,
                result: { some: 'result' }
            });
            mockCheckpointerManager.loadCheckpoint.mockResolvedValue({});

            await handleJobCompletion('job-1', workflowOperator, mockControlPlane);

            expect(streamWithInterruptHandling).toHaveBeenCalledWith(
                projectId,
                mockCompiledGraph,
                null,
                expect.anything(),
                'resumePipeline',
                mockPublishEvent
            );
        });
    });
});
