import { ApiError as GenAIApiError } from "@google/genai";
import { NodeInterrupt } from "@langchain/langgraph";
import { LlmRetryInterruptValue } from "../types/index.js";

export class RAIError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RAIError';
    }
}

export function extractErrorMessage(error: unknown): string {
    // Handle Error instances
    if (error instanceof Error) {
        return error.message || error.toString();
    }

    // Handle error objects with message property
    if (error && typeof error === 'object') {
        if ('message' in error && typeof error.message === 'string') {
            return error.message;
        }

        // Handle Google API errors specifically
        if ('code' in error && 'details' in error) {
            const code = (error as any).code;
            const details = (error as any).details;
            const message = (error as any).message || '';
            return `API Error (Code ${code}): ${message}${details ? ` - ${details}` : ''}`;
        }

        // Handle Error instances
        if (error instanceof GenAIApiError) {
            return `API Error (Code ${error.status}): ${error.message} - ${error.cause}`;
        }

        // Try to stringify the object
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    // Fallback to string conversion
    return String(error);
}

export function extractInterruptValue(error: unknown): LlmRetryInterruptValue | false {
    // interrupt value usually lives in message property
    if (error && typeof error === 'object') {
        if ('message' in error && typeof error.message === 'string') {
            try {
                const parsed: ({ value: LlmRetryInterruptValue; }[]) | LlmRetryInterruptValue = JSON.parse(error.message);
                if (Array.isArray(parsed) && parsed.length) {
                    return parsed.at(-1)!.value;
                } else {
                    return parsed as LlmRetryInterruptValue;
                }
            } catch (e) {
                // message is a string
                return false;
            }
        }
    }
    return false;
}

/**
 * Extract structured error details
 * @param error 
 * @returns 
 */
export function extractErrorDetails(error: unknown): Record<string, any> | undefined {
    if (!error || typeof error !== 'object') {
        return undefined;
    }

    const details: Record<string, any> = {};

    // Standard Error properties
    if (error instanceof Error) {
        details.name = error.name;
        details.message = error.message;
        if (error.stack) details.stack = error.stack;
    }

    // Google API error structure
    if ('code' in error) details.code = (error as any).code;
    if ('details' in error) details.details = (error as any).details;
    if ('metadata' in error) details.metadata = (error as any).metadata;
    if ('statusCode' in error) details.statusCode = (error as any).statusCode;
    if ('statusMessage' in error) details.statusMessage = (error as any).statusMessage;

    // Custom error properties (like RAIError)
    if ('type' in error) details.type = (error as any).type;
    if ('severity' in error) details.severity = (error as any).severity;

    return Object.keys(details).length > 0 ? details : undefined;
}

/**
 * Extract relevant parameters for retry
 * @param state 
 * @returns 
 */
export function extractRelevantParams(state: any): Record<string, any> {
    // Return only the parameters needed to retry the operation
    // Avoid including large data structures or sensitive information
    return {
        sceneId: state.currentSceneIndex,
        // Add other relevant parameters
    };
}

/**
 * Intercepts errors and throws a NodeInterrupt for human-in-the-loop intervention.
 * 
 * IMPORTANT: If the error is already a NodeInterrupt (e.g. from upstream batch processing),
 * it re-throws to preserve the original interrupt context.
 */
export function interceptNodeInterruptAndThrow(
    error: any,
    nodeName: string,
    projectId: string,
    context: Partial<LlmRetryInterruptValue> = {}
) {

    if (error instanceof NodeInterrupt) {
        console.debug("Caught Interrupt Value:", (error as any).value);
        throw error;
    }

    const errorMessage = extractErrorMessage(error);
    const errorDetails = extractErrorDetails(error);
    const defaults: Omit<LlmRetryInterruptValue, "projectId"> = {
        error: errorMessage,
        errorDetails: errorDetails,
        attempt: context?.attempt ?? 1,
        maxRetries: context?.maxRetries ?? 3,
        functionName: nodeName,
        lastAttemptTimestamp: new Date().toISOString(),
        type: 'llm_intervention',
        nodeName: nodeName,
        stackTrace: error instanceof Error ? error.stack : undefined,
    };

    let interruptValue = extractInterruptValue(error);
    if (!interruptValue) {
        interruptValue = {
            error: errorMessage,
            type: "llm_intervention", // can be defined as a different type
            functionName: nodeName,
            nodeName,
            projectId: projectId,
            attempt: defaults.attempt,
            maxRetries: defaults.maxRetries,
            lastAttemptTimestamp: defaults.lastAttemptTimestamp,
        }
    } else {
        interruptValue = {
            ...defaults,
            ...interruptValue,
            ...context,
            projectId: projectId
        };
    }

    throw new NodeInterrupt(interruptValue);
}
