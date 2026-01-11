import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkAndPublishInterruptFromSnapshot } from '../helpers/interrupts';
import { LlmRetryInterruptValue } from '../../shared/types/pipeline.types';
import { mergeParamsIntoState } from "../../shared/utils/utils";

describe('Interrupt Handling System', () => {

    // describe('Interrupt Handling System', () => {
    //     describe('checkAndPublishInterrupt', () => {
    //         it('should detect interrupt in state.values.__interrupt__', async () => {
    //             // Test primary detection method
    //         });

    //         it('should not publish duplicate events for resolved interrupts', async () => {
    //             // Test __interrupt_resolved__ flag
    //         });

    //         it('should fall back to state.tasks[].interrupts', async () => {
    //             // Test fallback method
    //         });

    //         it('should return false when no interrupt exists', async () => {
    //             // Test normal flow
    //         });
    //     });

    //     describe('handleResolveInterventionCommand', () => {
    //         it('should retry with revised params', async () => {
    //             // Test retry action
    //         });

    //         it('should skip failed node and continue', async () => {
    //             // Test skip action
    //         });

    //         it('should abort workflow', async () => {
    //             // Test abort action
    //         });

    //         it('should handle missing interrupt gracefully', async () => {
    //             // Test error cases
    //         });
    //     });

    //     describe('llmOperationNode', () => {
    //         it('should store interrupt data on error', async () => {
    //             // Test node error handling
    //         });

    //         it('should increment attempt counter', async () => {
    //             // Test retry tracking
    //         });

    //         it('should clear interrupt on success', async () => {
    //             // Test success path
    //         });
    //     });
    // });

    describe('checkAndPublishInterruptFromSnapshot', () => {
        const mockPublishEvent = vi.fn();
        const mockCompiledGraph = {
            getState: vi.fn()
        };
        const mockRunnableConfig = { configurable: { thread_id: 'test-thread' } };
        const projectId = 'test-project';

        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should detect interrupt in state.values.__interrupt__', async () => {
            const interruptValue: LlmRetryInterruptValue = {
                type: 'llm_intervention',
                error: 'Test error',
                functionName: 'testFunction',
                nodeName: 'testNode',
                params: { key: 'value' },
                attemptCount: 1
            };

            mockCompiledGraph.getState.mockResolvedValue({
                values: {
                    __interrupt__: interruptValue,
                    __interrupt_resolved__: false
                },
                tasks: []
            });

            const result = await checkAndPublishInterruptFromSnapshot(
                projectId,
                mockCompiledGraph,
                mockRunnableConfig,
                mockPublishEvent
            );

            expect(result).toBe(true);
            expect(mockPublishEvent).toHaveBeenCalledWith(expect.objectContaining({
                type: 'LLM_INTERVENTION_NEEDED',
                projectId,
                payload: expect.objectContaining({
                    error: 'Test error',
                    nodeName: 'testNode'
                })
            }));
        });

        it('should not publish if interrupt is already resolved', async () => {
            const interruptValue: LlmRetryInterruptValue = {
                type: 'llm_intervention',
                error: 'Test error',
                functionName: 'testFunction',
                nodeName: 'testNode',
                params: {},
                attemptCount: 1
            };

            mockCompiledGraph.getState.mockResolvedValue({
                values: {
                    __interrupt__: interruptValue,
                    __interrupt_resolved__: true
                },
                tasks: []
            });

            const result = await checkAndPublishInterruptFromSnapshot(
                projectId,
                mockCompiledGraph,
                mockRunnableConfig,
                mockPublishEvent
            );

            expect(result).toBe(false);
            expect(mockPublishEvent).not.toHaveBeenCalled();
        });

        it('should fall back to state.tasks[].interrupts', async () => {
            const interruptValue: LlmRetryInterruptValue = {
                type: 'llm_retry_exhausted',
                error: 'Exhausted',
                functionName: 'testFunction',
                nodeName: 'testNode',
                params: {},
                attemptCount: 3
            };

            mockCompiledGraph.getState.mockResolvedValue({
                values: {},
                tasks: [
                    {
                        name: 'testNode',
                        interrupts: [
                            { value: interruptValue }
                        ]
                    }
                ]
            });

            const result = await checkAndPublishInterruptFromSnapshot(
                projectId,
                mockCompiledGraph,
                mockRunnableConfig,
                mockPublishEvent
            );

            expect(result).toBe(true);
            expect(mockPublishEvent).toHaveBeenCalledWith(expect.objectContaining({
                type: 'LLM_INTERVENTION_NEEDED',
                payload: expect.objectContaining({
                    error: 'Exhausted',
                    nodeName: 'testNode'
                })
            }));
        });

        it('should return false when no interrupt exists', async () => {
            mockCompiledGraph.getState.mockResolvedValue({
                values: {},
                tasks: []
            });

            const result = await checkAndPublishInterruptFromSnapshot(
                projectId,
                mockCompiledGraph,
                mockRunnableConfig,
                mockPublishEvent
            );

            expect(result).toBe(false);
            expect(mockPublishEvent).not.toHaveBeenCalled();
        });
    });

    describe('mergeParamsIntoState', () => {
        it('should merge scenePromptOverrides', () => {
            const currentState: any = {
                scenePromptOverrides: {
                    1: 'old prompt'
                }
            };
            const params = {
                sceneId: '2',
                promptModification: 'new prompt'
            };

            const updates = mergeParamsIntoState(currentState, params);

            expect(updates.scenePromptOverrides).toEqual({
                1: 'old prompt',
                2: 'new prompt'
            });
        });

        it('should merge enhancedPrompt', () => {
            const currentState: any = {
                enhancedPrompt: 'old'
            };
            const params = {
                enhancedPrompt: 'new'
            };

            const updates = mergeParamsIntoState(currentState, params);

            expect(updates.enhancedPrompt).toEqual('new');
        });
    });
});
