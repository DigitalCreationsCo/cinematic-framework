import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextModelController } from '../../shared/llm/text-model-controller.js';

// Mock the GoogleProvider module with proper class syntax
vi.mock('../llm/google/provider', () => {
    class MockGoogleProvider {
        generateContent = vi.fn().mockResolvedValue('mocked content');
        generateImages = vi.fn().mockResolvedValue('mocked images');
        countTokens = vi.fn().mockResolvedValue({ totalTokens: 100 });
    }
    return {
        GoogleProvider: MockGoogleProvider,
    };
});

describe('TextModelController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize with google provider by default', () => {
        const controller = new TextModelController();
        expect(controller.provider).toBeDefined();
    });

    it('should have generateContent method', async () => {
        const controller = new TextModelController();
        const testParams = { model: 'gemini-pro', contents: [] };
        const result = await controller.generateContent(testParams);
        expect(result).toBe('mocked content');
    });

    it('should have generateImages method', async () => {
        const controller = new TextModelController();
        const testParams = { model: 'imagen', prompt: 'test', config: {} };
        const result = await controller.generateImages(testParams);
        expect(result).toBe('mocked images');
    });

    it('should have countTokens method', async () => {
        const controller = new TextModelController();
        const testParams = { model: 'gemini-pro', contents: [] };
        const result = await controller.countTokens(testParams);
        expect(result).toEqual({ totalTokens: 100 });
    });
});
