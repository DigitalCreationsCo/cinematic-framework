import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContinuityManagerAgent } from './continuity-manager';
import { GCPStorageManager } from '../storage-manager';
import { FrameCompositionAgent } from './frame-composition-agent';
import { QualityCheckAgent } from './quality-check-agent';
import { LlmController } from '../llm/controller';
import { Scene, Storyboard } from '../shared/pipeline-types';

// Mock dependencies
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
    GoogleGenAI: class {
        models = { generateContent: mockGenerateContent };
    },
    HarmCategory: {},
    HarmBlockThreshold: {},
    HarmBlockMethod: {},
    Modality: { IMAGE: 'IMAGE' },
    ApiError: class extends Error { },
}));

describe('ContinuityManagerAgent', () => {
    let continuityManager: ContinuityManagerAgent;
    let llm: LlmController;
    let imageModel: LlmController;
    let storageManager: GCPStorageManager;
    let frameComposer: FrameCompositionAgent;
    let qualityAgent: QualityCheckAgent;

    beforeEach(() => {
        vi.clearAllMocks();

        llm = new LlmController();
        imageModel = new LlmController();
        storageManager = new GCPStorageManager('project-id', 'video-id', 'bucket-name');
        qualityAgent = new QualityCheckAgent(llm, storageManager);
        frameComposer = new FrameCompositionAgent(imageModel, qualityAgent, storageManager);

        // Mock specific methods
        vi.spyOn(storageManager, 'getGcsObjectPath').mockImplementation((params) => {
            if (params.type === 'scene_start_frame') return `frames/scene_${params.sceneId}_start.png`;
            if (params.type === 'scene_end_frame') return `frames/scene_${params.sceneId}_end.png`;
            return 'path';
        });
        vi.spyOn(storageManager, 'getGcsUrl').mockImplementation((path) => `gs://bucket/${path}`);
        vi.spyOn(frameComposer, 'generateImage').mockResolvedValue({ storageUri: 'gs://bucket/generated_frame.png', publicUri: 'public_uri.png' });
        vi.spyOn(qualityAgent, 'evaluateFrameQuality').mockResolvedValue({
            overall: 'ACCEPT',
            scores: {
                narrativeFidelity: { rating: 'PASS', weight: 1, details: 'Good' },
                characterConsistency: { rating: 'PASS', weight: 1, details: 'Good' },
                technicalQuality: { rating: 'PASS', weight: 1, details: 'Good' },
                emotionalAuthenticity: { rating: 'PASS', weight: 1, details: 'Good' },
                continuity: { rating: 'PASS', weight: 1, details: 'Good' },
            },
            issues: [],
            feedback: "Looks good",
        });

        continuityManager = new ContinuityManagerAgent(llm, imageModel, frameComposer, qualityAgent, storageManager);
        // Disable quality check for simple test or mock it effectively
        // (qualityAgent mock above should handle it if enabled)
    });

    it('should skip generation if frames exist in storage', async () => {
        const scenes: Scene[] = [
            {
                id: 1,
                startTime: 0,
                endTime: 5,
                duration: 5,
                description: 'Scene 1',
                characters: [],
                locationId: 'loc1',
                lighting: 'day',
                mood: 'happy',
                // ... other required props
            } as any
        ];

        const storyboard: Storyboard = {
            scenes,
            characters: [],
            locations: []
        } as any;

        // Mock fileExists to return true
        vi.spyOn(storageManager, 'fileExists').mockResolvedValue(true);

        const result = await continuityManager.generateSceneFramesBatch(scenes, storyboard);

        expect(storageManager.fileExists).toHaveBeenCalledTimes(2); // Start and End frame
        expect(frameComposer.generateImage).not.toHaveBeenCalled();
        expect(result[ 0 ].startFrame?.storageUri).toBe('gs://bucket/frames/scene_1_start.png');
        expect(result[ 0 ].endFrame?.storageUri).toBe('gs://bucket/frames/scene_1_end.png');
    });

    it('should generate frames if they do not exist in storage', async () => {
        const scenes: Scene[] = [
            {
                id: 2,
                startTime: 5,
                endTime: 10,
                duration: 5,
                description: 'Scene 2',
                characters: [],
                locationId: 'loc1',
                lighting: 'day',
                mood: 'sad',
                // ... other required props
            } as any
        ];

        const storyboard: Storyboard = {
            scenes,
            characters: [],
            locations: []
        } as any;

        // Mock fileExists to return false
        vi.spyOn(storageManager, 'fileExists').mockResolvedValue(false);

        const result = await continuityManager.generateSceneFramesBatch(scenes, storyboard);

        expect(storageManager.fileExists).toHaveBeenCalledTimes(2);
        expect(frameComposer.generateImage).toHaveBeenCalledTimes(2);
        expect(result[ 0 ].startFrame?.storageUri).toBe('gs://bucket/generated_frame.png');
        expect(result[ 0 ].endFrame?.storageUri).toBe('gs://bucket/generated_frame.png');
    });
});
