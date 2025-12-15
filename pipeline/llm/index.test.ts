import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmController } from './controller';
import { GoogleProvider } from './google/google-provider';

// Mock the GoogleProvider module
vi.mock('./google/google-provider', () => {
    // Create mock functions for the provider methods
    const mockGenerateContent = vi.fn();
    const mockGenerateVideos = vi.fn();
    const mockGetVideosOperation = vi.fn();

    return {
        GoogleProvider: vi.fn(() => ({
            generateContent: mockGenerateContent,
            generateImages: vi.fn(),
            generateVideos: mockGenerateVideos,
            getVideosOperation: mockGetVideosOperation,
        })),
    };
});

describe('LlmController', () => {
    // Get references to the mocked functions
    const MockGoogleProvider = GoogleProvider as unknown as ReturnType<typeof vi.fn>;
    let mockGenerateContent: ReturnType<typeof vi.fn>;
    let mockGenerateVideos: ReturnType<typeof vi.fn>;
    let mockGetVideosOperation: ReturnType<typeof vi.fn>;
    let testParams = {
        model: '',
        contents: []
    }

    beforeEach(() => {
        vi.clearAllMocks();

        // Access the mock instances from the mocked GoogleProvider
        const instance = new MockGoogleProvider();
        mockGenerateContent = instance.generateContent;
        mockGenerateVideos = instance.generateVideos;
        mockGetVideosOperation = instance.getVideosOperation;

        // Reset mock implementations for each test, if needed
        mockGenerateContent.mockResolvedValue('mocked content');
        mockGenerateVideos.mockResolvedValue('mocked videos');
        mockGetVideosOperation.mockResolvedValue('mocked operation');
    });

    it('should proxy generateContent calls to the provider', async () => {
        const wrapper = new LlmController();
        const result = await wrapper.generateContent(testParams);
        expect(result).toBe('mocked content');
        expect(mockGenerateContent).toHaveBeenCalledWith(testParams);
    });

    it('should proxy generateVideos calls to the provider', async () => {
        const wrapper = new LlmController();
        const result = await wrapper.generateVideos(testParams);
        expect(result).toBe('mocked videos');
        expect(mockGenerateVideos).toHaveBeenCalledWith(testParams);
    });

    it('should proxy getVideosOperation calls to the provider', async () => {
        const wrapper = new LlmController();
        const result = await wrapper.getVideosOperation(testParams);
        expect(result).toBe('mocked operation');
        expect(mockGetVideosOperation).toHaveBeenCalledWith(testParams);
    });
});
