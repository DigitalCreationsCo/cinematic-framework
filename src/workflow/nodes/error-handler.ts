import { Command } from "@langchain/langgraph";
import { WorkflowState } from "@shared/types/workflow.types";
import { interceptNodeInterruptAndThrow } from "@shared/utils/errors";

export const errorHandler = async (state: WorkflowState) => {
    const errorContext = state[ 'errors' ].at(-1);
    if (state.__interrupt__?.length && state.__interrupt_resolved__ === true) {
        console.log(`[Error Handler Node]: Interrupt found. Retrying node: ${errorContext?.node}`);
        console.debug(`Error context: `, JSON.stringify({ errorContext }));
        return new Command({
            goto: errorContext?.node,
            update: {
                errors: state.errors.slice(0, -1)
            }
        });
    }

    // const shouldRetry = errorContext?.shouldRetry;
    // if (shouldRetry) {
    //     console.log(`[Error Handler]: Auto-retrying node: ${errorContext?.node}`);
    //     return new Command({
    //         goto: errorContext?.node,
    //         // Optional: Clear the error from the stack so the next run is clean
    //         update: {
    //             errors: state.errors.slice(0, -1)
    //         }
    //     });
    // }
    
    interceptNodeInterruptAndThrow(errorContext, errorContext?.node || "Error Handler Node", state.projectId);
};