import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retryLlmCall } from '../../shared/utils/llm-retry.js';
import { interrupt } from '@langchain/langgraph';

// Mock GraphInterrupt
vi.mock('@langchain/langgraph', () => {
    return {
        interrupt: vi.fn(),
        GraphInterrupt: class extends Error { constructor() { super(); } }
    };
});

const retryConfig = { attempt: 1, maxRetries: 3, projectId: '1' };

describe('retryLlmCall', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return the result on the first successful call', async () => {
        const llmCall = vi.fn().mockResolvedValue('success');
        const result = await retryLlmCall(llmCall, 'test-params', retryConfig);
        expect(result).toBe('success');
        expect(llmCall).toHaveBeenCalledTimes(1);
        expect(interrupt).not.toHaveBeenCalled();
    });

    it('should trigger interrupt on failure', async () => {
        const llmCall = vi.fn().mockRejectedValue(new Error('failure'));

        // Mock interrupt to not return anything (simulate stop) or throw error to break loop
        // If interrupt returns null/undefined, the code throws "LLM call failed and resolution was not provided."
        (interrupt as any).mockReturnValue(undefined);

        await expect(retryLlmCall(llmCall, 'test-params', retryConfig)).rejects.toThrow('LLM call failed and resolution was not provided.');
        expect(llmCall).toHaveBeenCalledTimes(1);
        expect(interrupt).toHaveBeenCalled();
    });

    it('should retry when interrupt returns retry action', async () => {
        const llmCall = vi.fn()
            .mockRejectedValueOnce(new Error('failure 1'))
            .mockResolvedValue('success');

        // First call fails, triggers interrupt. We mock interrupt to return 'retry'.
        (interrupt as any).mockReturnValueOnce({ action: 'retry' });

        const result = await retryLlmCall(llmCall, 'test-params', retryConfig);
        expect(result).toBe('success');
        expect(llmCall).toHaveBeenCalledTimes(2);
        expect(interrupt).toHaveBeenCalledTimes(1);
    });

    it('should retry with revised params when interrupt returns revisedParams', async () => {
        const llmCall = vi.fn()
            .mockRejectedValueOnce(new Error('failure 1'))
            .mockResolvedValue('success');

        (interrupt as any).mockReturnValueOnce({ action: 'retry', revisedParams: 'new-params' });

        const result = await retryLlmCall(llmCall, 'test-params', retryConfig);
        expect(result).toBe('success');
        expect(llmCall).toHaveBeenCalledTimes(2);
        expect(llmCall).toHaveBeenLastCalledWith('new-params');
    });

    it('should throw error if user cancels via interrupt', async () => {
        const llmCall = vi.fn().mockRejectedValue(new Error('failure'));
        (interrupt as any).mockReturnValue({ action: 'cancel' });

        await expect(retryLlmCall(llmCall, 'test-params', retryConfig)).rejects.toThrow('User cancelled operation.');
    });
});
