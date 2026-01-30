//pipeline/lib/llm-retry.ts
import { interrupt } from "@langchain/langgraph";
import { LlmRetryInterruptValue } from "../types/index.js";
import { ApiError } from "@google/genai";



/**
 * Configuration for retrying LLM calls.
 * @property {number} attempt - The current execution count.
 * @property {number} maxRetries - The maximum number of retries.
 * @property {number} initialDelay - The initial delay in milliseconds.
 * @property {number} backoffFactor - The factor by which the delay increases.
 */
export type RetryConfig = {
    attempt: number;
    maxRetries: number;
    initialDelay?: number;
    backoffFactor?: number;
    projectId: string;
};

const defaultRetryConfig = { initialDelay: 1000, backoffFactor: 2, };

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
export async function retryLlmCall<U, T>(
    llmCall: (params: T) => Promise<U>,
    initialParams: T,
    config: RetryConfig,
    onRetry?: (error: any, attempt: number, currentParams: T) => Promise<({ params: T; attempt: number; })>
): Promise<U> {
    const retryConfig = { ...defaultRetryConfig, ...config };
    let params = initialParams;
    let delay = retryConfig.initialDelay;
    let { attempt, maxRetries } = retryConfig;

    async function incrementAndRetry(error: any) {
        attempt++;
        if (attempt <= maxRetries) {
            console.error({ error, attempt, maxRetries, projectId: retryConfig.projectId }, `LLM call failed. Retrying...`);
            console.log(`Waiting ${delay / 1000}s before retry.`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= retryConfig.backoffFactor;
        }
    }

    while (attempt <= maxRetries) {
        try {
            console.log({ attempt, maxRetries, functionName: llmCall.name }, `Calling LLM (Attempt ${attempt})...`);
            console.debug({ params: JSON.stringify(params, null, 2) });
            return await llmCall(params);
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.status === 429) {
                    await incrementAndRetry(error);
                    continue;
                }
            }

            console.error('LLM call failed. Triggering graph interrupt for human intervention.Error: ', error);
            throw error;
        //     const interruptValue: LlmRetryInterruptValue = {
        //         nodeName: "",
        //         type: "llm_intervention",
        //         error: error instanceof Error ? error.message : String(error),
        //         params: params as any,
        //         attempt: attempt,
        //         functionName: llmCall.name || "Unknown Function",
        //         lastAttemptTimestamp: new Date().toISOString(),
        //         projectId: retryConfig.projectId,
        //     };

        //     const resolution = interrupt(interruptValue);
        //     if (resolution) {
        //         if (resolution.action === 'cancel') {
        //             throw new Error('User cancelled operation.');
        //         }
        //         if (resolution.action === 'retry') {
        //             if (onRetry) {
        //                 const { attempt: nextAttempt, params: nextParams } = await onRetry(error, attempt, params);
        //                 attempt = nextAttempt;
        //                 params = nextParams;
        //             }
        //             if (resolution.revisedParams) {
        //                 params = resolution.revisedParams as T;
        //                 console.debug('Resuming with revised params.');
        //             } else {
        //                 console.debug('Resuming retry with original params.');
        //             }
        //             attempt++;
        //             console.log(`Waiting ${delay / 1000}s before retry.`);
        //             await new Promise(resolve => setTimeout(resolve, delay));
        //             delay *= retryConfig.backoffFactor;

        //             continue;
        //         }
        //     }
        }
    }

    throw new Error('LLM call failed and resolution was not provided.');
}
