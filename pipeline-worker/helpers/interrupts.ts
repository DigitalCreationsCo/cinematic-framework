import { RunnableConfig } from "@langchain/core/runnables";
import { Character, Location, GraphState, InitialGraphState, LlmRetryInterruptValue } from "../../shared/pipeline-types";
import { PipelineEvent } from "../../shared/pubsub-types";

export type PipelineEventPublisher = (event: PipelineEvent) => Promise<void>;

export async function checkAndPublishInterruptFromSnapshot(
    projectId: string,
    compiledGraph: any,
    runnableConfig: RunnableConfig,
    publishEvent: PipelineEventPublisher
): Promise<boolean> {
    try {
        console.log(`[Worker] Checking for interrupts from state snapshot. ProjectId: ${projectId}`);

        // Get current state snapshot
        const stateSnapshot = await compiledGraph.getState(runnableConfig);

        // Method 1: Check state values for interrupt data
        if (stateSnapshot.values?.__interrupt__?.[ 0 ].value) {
            const interruptValue = (stateSnapshot.values as GraphState)?.__interrupt__?.[ 0 ].value!;

            console.log(`[Worker] Interrupt detected in state:`, {
                type: interruptValue.type,
                nodeName: interruptValue.nodeName,
                functionName: interruptValue.functionName,
                attemptCount: interruptValue.attemptCount
            });

            // Only publish if not already resolved
            // if (!stateSnapshot.values.__interrupt_resolved__) {
            //     await publishEvent({
            //         type: "LLM_INTERVENTION_NEEDED",
            //         projectId,
            //         payload: {
            //             error: interruptValue.error,
            //             params: interruptValue.params,
            //             functionName: interruptValue.functionName,
            //             nodeName: interruptValue.nodeName,
            //             attemptCount: interruptValue.attemptCount
            //         },
            //         timestamp: new Date().toISOString()
            //     });

            //     return true;
            // }
        }

        // Method 2: Check if graph is paused (state.next is populated)
        if (stateSnapshot.next && stateSnapshot.next.length > 0) {
            console.log(`[Worker] Graph paused at nodes: ${stateSnapshot.next.join(', ')}`);

            // If paused but no interrupt data, this might be a different type of pause
            // Log for debugging but don't publish intervention event
            if (stateSnapshot.values?.__interrupt__?.[ 0 ].value) {
                console.warn(`[Worker] Graph paused but no interrupt data found`);
            }
        }

        // Method 3: Fallback - check tasks array (for interrupt_before/after)
        if (stateSnapshot.tasks && stateSnapshot.tasks.length > 0) {
            for (const task of stateSnapshot.tasks) {
                if (task.interrupts && task.interrupts.length > 0) {
                    const interrupt = task.interrupts[ 0 ];
                    const interruptValue = interrupt.value as LlmRetryInterruptValue;

                    if (interruptValue && (interruptValue.type === 'llm_intervention' ||
                        interruptValue.type === 'llm_retry_exhausted')) {

                        console.log(`[Worker] Interrupt found in task:`, task.name);

                        // await publishEvent({
                        //     type: "LLM_INTERVENTION_NEEDED",
                        //     projectId,
                        //     payload: {
                        //         error: interruptValue.error,
                        //         params: interruptValue.params,
                        //         functionName: interruptValue.functionName,
                        //         nodeName: interruptValue.nodeName || task.name,
                        //         attemptCount: interruptValue.attemptCount
                        //     },
                        //     timestamp: new Date().toISOString()
                        // });

                        return true;
                    }
                }
            }
        }

    } catch (error) {
        console.error("[Worker] Error checking for interrupts:", error);
    }

    return false;
}

export async function checkAndPublishInterruptFromStream(
    projectId: string,
    streamValues: InitialGraphState | GraphState,
    publishEvent: PipelineEventPublisher
): Promise<boolean> {
    try {
        console.log(`[Worker] Checking for interrupts for projectId: ${projectId}`);

        if (streamValues.__interrupt__?.[ 0 ].value) {
            const interruptValue = streamValues.__interrupt__?.[ 0 ].value!;

            console.log(`[Worker] Interrupt detected in state:`, {
                type: interruptValue.type,
                nodeName: interruptValue.nodeName,
                functionName: interruptValue.functionName,
                attemptCount: interruptValue.attemptCount
            });

            if (!streamValues.__interrupt_resolved__) {
                await publishEvent({
                    type: "LLM_INTERVENTION_NEEDED",
                    projectId,
                    payload: {
                        error: interruptValue.error,
                        params: interruptValue.params,
                        functionName: interruptValue.functionName,
                        nodeName: interruptValue.nodeName,
                        attemptCount: interruptValue.attemptCount
                    },
                    timestamp: new Date().toISOString()
                });

                return true;
            }
        }
    } catch (error) {
        console.error("[Worker] Error checking for interrupts:", error);
    }

    return false;
}

export function mergeParamsIntoState(
    currentState: GraphState,
    params: Partial<{
        sceneId: string;
        creativePrompt: string;
        promptModification: string;
        characters: Character[];
        locations: Location[];
        sceneDescriptions: string[];
    }>
): Partial<GraphState> {
    const updates: Partial<GraphState> = {};

    // Merge scene prompt overrides
    if (params.promptModification && params.sceneId !== undefined) {
        updates.scenePromptOverrides = {
            ...(currentState.scenePromptOverrides || {}),
            [ params.sceneId ]: params.promptModification
        };
    }

    // Merge creative prompt if provided
    if (params.creativePrompt) {
        updates.creativePrompt = params.creativePrompt;
    }

    if (params.characters) {
        if (updates?.storyboardState?.characters) {
            updates.storyboardState.characters = params.characters;
        }
    }

    if (params.sceneDescriptions && params.sceneDescriptions.length > 0) {
        if (updates?.storyboardState?.scenes) {
            updates.storyboardState.scenes = updates.storyboardState.scenes.map((s, idx) => {
                return {
                    ...s,
                    description: params.sceneDescriptions![ idx ]
                };
            });
        }
    }

    // Add other specific param mappings here as needed

    return updates;
}
