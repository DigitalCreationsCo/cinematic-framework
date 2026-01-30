import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleProvider } from '../../shared/llm/google/provider.js';
import { GoogleGenAI } from '@google/genai';

// Mock the entire @google/genai module
const mockGenerateContent = vi.fn();
const mockGenerateVideos = vi.fn();
const mockGenerateImages = vi.fn();
const mockGetVideosOperation = vi.fn();

vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: class {
            models = {
                generateContent: mockGenerateContent,
                generateVideos: mockGenerateVideos,
                generateImages: mockGenerateImages,
            };
            operations = {
                getVideosOperation: mockGetVideosOperation,
            };
        },
        // Export other necessary types/enums as needed by the actual code if they are used as values
        // For types used only as types, no need to export here.
    };
});

describe('GoogleProvider', () => {
    let provider: GoogleProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new GoogleProvider();
    });

    it('should proxy generateContent calls to the underlying model', async () => {
        mockGenerateContent.mockResolvedValue('content');

        const params = { model: 'test-model', contents: [] };
        const result = await provider.generateContent(params);

        expect(result).toBe('content');
        expect(mockGenerateContent).toHaveBeenCalledWith(params);
    });

    it('should proxy generateVideos calls to the underlying model', async () => {
        mockGenerateVideos.mockResolvedValue('videos');

        const params = { model: 'test-model', prompt: 'test' };
        const result = await provider.generateVideos(params);

        expect(result).toBe('videos');
        expect(mockGenerateVideos).toHaveBeenCalledWith(params);
    });

    it('should proxy getVideosOperation calls to the underlying operations', async () => {
        mockGetVideosOperation.mockResolvedValue('operation');

        const params = { operation: { name: 'ops/123' } } as any;
        const result = await provider.getVideosOperation(params);

        expect(result).toBe('operation');
        expect(mockGetVideosOperation).toHaveBeenCalledWith(params);
    });
});
