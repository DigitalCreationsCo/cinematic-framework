import { Command } from "@langchain/langgraph";
import { WorkflowState } from "@shared/types/pipeline.types";
import { interceptNodeInterruptAndThrow } from "@shared/utils/errors";

export const errorHandler = async (state: WorkflowState) => {
    const errorContext = state[ 'errors' ].at(-1);

    if (state.__interrupt__ && !state.__interrupt_resolved__) {
        console.log(`Retrying node: ${errorContext?.node}`);
        return new Command({
            goto: errorContext?.node
        });
    }
    console.log(`Retrying node: ${errorContext?.node}`);
    interceptNodeInterruptAndThrow(errorContext, errorContext?.node || "Error Handler Node");
};