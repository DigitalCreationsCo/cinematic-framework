import { Command } from "@langchain/langgraph";
import { WorkflowState } from "../../shared/types/index.js";
import { interceptNodeInterruptAndThrow } from "../../shared/utils/errors.js";

export const errorHandler = async (state: WorkflowState) => {

    const errorContext = state[ 'errors' ].at(-1);
    console.debug(`[Error Handler Node] Error context: `, JSON.stringify({ errorContext }));

    // if (state.__interrupt__?.length && !state.__interrupt_resolved__) {
        console.log(`[Error Handler Node]: Interrupt found. Surfacing unresolved error to user...`);
        interceptNodeInterruptAndThrow(errorContext, errorContext?.node || "Error Handler Node", state.projectId);
        return;
    // }

    console.log(`[Error Handler Node]: No interrupt found. Retrying node: ${errorContext?.node}`);
    return new Command({
        goto: errorContext?.node,
        update: {
            errors: state.errors.slice(0, -1)
        }
    });
};