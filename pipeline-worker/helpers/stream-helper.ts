import { GraphState } from "../../shared/pipeline-types";
import { RunnableConfig } from "@langchain/core/runnables";
import { checkAndPublishInterruptFromSnapshot, checkAndPublishInterruptFromStream } from "./interrupts";
import { PipelineEvent } from "../../shared/pubsub-types";

export async function streamWithInterruptHandling(
    projectId: string,
    compiledGraph: any,
    initialState: any,
    runnableConfig: RunnableConfig,
    commandName: string,
    publishEvent: (event: PipelineEvent) => Promise<void>
): Promise<void> {
    console.log(`[${commandName}] Starting stream for projectId: ${projectId}`);

    try {
        const stream = await compiledGraph.stream(
            initialState,
            {
                ...runnableConfig,
                streamMode: [ "values" ]
            }
        );

        for await (const step of stream) {
            try {
                console.debug(`[${commandName}] Processing stream step`);

                const [ _, state ] = Object.entries(step)[ 0 ];

                // Publish state update
                await publishEvent({
                    type: "FULL_STATE",
                    projectId,
                    payload: { state: state as GraphState },
                    timestamp: new Date().toISOString()
                });

                await checkAndPublishInterruptFromStream(projectId, state as GraphState, publishEvent);

            } catch (error) {
                console.error(`[${commandName}] Error publishing state:`, error);
                // Don't throw - continue processing stream
            }
        }

        console.log(`[${commandName}] Stream completed`);

    } catch (error) {
        console.error(`[${commandName}] Error during stream execution:`, error);

        // Check if this is an interrupt (not a real error)
        const isInterrupt = await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishEvent);

        if (!isInterrupt) {
            // Real error - publish failure
            await publishEvent({
                type: "WORKFLOW_FAILED",
                projectId,
                payload: {
                    error: `Stream execution failed: ${error instanceof Error ? error.message : String(error)}`
                },
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    } finally {
        await checkAndPublishInterruptFromSnapshot(projectId, compiledGraph, runnableConfig, publishEvent);
    }
}
