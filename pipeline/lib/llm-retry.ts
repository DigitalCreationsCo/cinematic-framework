import { interrupt } from "@langchain/langgraph";
import { LlmRetryInterruptValue } from "../../shared/pipeline-types";

/**
 * Configuration for retrying LLM calls.
 * @property {number} maxRetries - The maximum number of retries.
 * @property {number} initialDelay - The initial delay in milliseconds.
 * @property {number} backoffFactor - The factor by which the delay increases.
 */
export type RetryConfig = {
    maxRetries?: number;
    initialDelay?: number;
    backoffFactor?: number;
};

const defaultRetryConfig: Required<RetryConfig> = { maxRetries: 3, initialDelay: 1000, backoffFactor: 2, };

/**
 * Retries an LLM call with human-in-the-loop intervention on error.
 * Instead of automatic retries, triggers a graph interrupt to allow user to modify params or retry.
 *
 * @param llmCall - The LLM call to retry.
 * @param params - The parameters for the LLM call.
 * @param retryConfig - The retry configuration (legacy, mostly unused now as we interrupt immediately).
 * @param onRetry - Optional callback to modify params or handle error before retry.
 * @returns The completion from the LLM call.
 */
export async function retryLlmCall<T, U>(
    llmCall: (params: T) => Promise<U>,
    initialParams: T,
    retryConfig: RetryConfig = {},
    onRetry?: (error: any, attempt: number, currentParams: T) => Promise<T | void>
): Promise<U> {
    let params = initialParams;
    let retries = 0;

    // We loop infinitely until success or user cancel
    while (true) {
        try {
            console.log(`Calling LLM (Attempt ${retries + 1})...`);
            return await llmCall(params);
        } catch (error) {
            console.error('LLM call failed. Triggering graph interrupt for human intervention.');

            const interruptValue: LlmRetryInterruptValue = {
                type: "llm_intervention",
                error: error instanceof Error ? error.message : String(error),
                params: params,
                retries: retries,
                functionName: llmCall.name || "Unknown Function"
            };

            // Trigger Graph Interrupt
            // The graph execution will pause here.
            // When resumed with Command({ resume: { action: 'retry', revisedParams: ... } }), this value will be returned.
            const resolution = interrupt(interruptValue);

            // If we are here, it means the graph was resumed!
            if (resolution) {
                // User provided new params or action
                if (resolution.action === 'cancel') {
                    throw new Error('User cancelled operation.');
                }
                
                if (resolution.action === 'retry') {
                    if (resolution.revisedParams) {
                        params = resolution.revisedParams;
                        console.log('Resuming with revised params.');
                    } else {
                        console.log('Resuming retry with original params.');
                    }
                    retries++;
                    continue;
                }
            }

            throw new Error('LLM call failed and resolution was not provided.');
        }
    }
}
