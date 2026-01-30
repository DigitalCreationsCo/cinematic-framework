import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContinuityManagerAgent } from '../../shared/agents/continuity-manager.js';
import { GCPStorageManager } from '../../shared/services/storage-manager.js';
import { FrameCompositionAgent } from '../../shared/agents/frame-composition-agent.js';
import { QualityCheckAgent } from '../../shared/agents/quality-check-agent.js';
import { TextModelController } from '../../shared/llm/text-model-controller.js';
import { Scene, Project } from '../../shared/../shared/types/index.js';
import { AssetVersionManager } from '../../shared/services/asset-version-manager.js';

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
    ThinkingLevel: { HIGH: 'HIGH' },
    ApiError: class extends Error { },
}));

// Mock AssetVersionManager
const mockAssetManager = {
    getNextVersionNumber: vi.fn(),
    getBestVersion: vi.fn(),
};

describe('ContinuityManagerAgent', () => {
    let continuityManager: ContinuityManagerAgent;
    let llm: TextModelController;
    let imageModel: TextModelController;
    let storageManager: GCPStorageManager;
    let frameComposer: FrameCompositionAgent;
    let qualityAgent: QualityCheckAgent;

    beforeEach(() => {
        vi.clearAllMocks();

        llm = new TextModelController();
        imageModel = new TextModelController();
        storageManager = new GCPStorageManager('project-id', 'video-id', 'bucket-name');
        qualityAgent = new QualityCheckAgent(llm, storageManager);
        frameComposer = new FrameCompositionAgent(llm, imageModel, qualityAgent, storageManager, undefined as any);

        // Mock specific methods
        vi.spyOn(storageManager, 'getObjectPath').mockImplementation((params) => {
            if (params.type === 'scene_start_frame') return `frames/scene_${params.sceneId}_start.png`;
            if (params.type === 'scene_end_frame') return `frames/scene_${params.sceneId}_end.png`;
            return 'path';
        });
        vi.spyOn(storageManager, 'getGcsUrl').mockImplementation((path) => `gs://bucket/${path}`);
        vi.spyOn(frameComposer, 'generateImage').mockResolvedValue({ data: { scene: {} as any, image: 'gs://bucket/generated_frame.png', }, metadata: { attempts: 1, acceptedAttempt: 1, model: 'test-model' } });
        vi.spyOn(qualityAgent, 'evaluateFrameQuality').mockResolvedValue({
            grade: 'ACCEPT',
            score: 90,
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

        continuityManager = new ContinuityManagerAgent(llm, imageModel, frameComposer, qualityAgent, storageManager, mockAssetManager as any);
        // Disable quality check for simple test or mock it effectively
        // (qualityAgent mock above should handle it if enabled)

        // Setup default mock response for generateContent
        mockGenerateContent.mockResolvedValue({
            text: "mock response",
            response: {
                candidates: [
                    {
                        content: {
                            parts: [ { text: "mock response" } ]
                        }
                    }
                ]
            }
        });
    });

    it('should skip generation if frames exist in storage', async () => {
        const scenes: Scene[] = [
            {
                id: '1', // Ensure ID is string to match types
                startTime: 0,
                endTime: 5,
                duration: 5,
                description: 'Scene 1',
                characters: [],
                locationId: 'loc1',
                lighting: 'day',
                mood: 'happy',
                assets: {},
                location: 'loc1',
                // ... other required props
            } as any
        ];

        const project: Project = {
            id: 'proj1',
            metadata: {} as any,
            scenes,
            characters: [],
            locations: [ { id: 'loc1', name: 'Test Location', assets: {} } as any ]
        } as any;

        // Mock fileExists to return true
        vi.spyOn(storageManager, 'fileExists').mockResolvedValue(true);
        mockAssetManager.getNextVersionNumber.mockResolvedValue([ 1 ]);

        const saveAssets = vi.fn();
        const updateScene = vi.fn();
        const onAttempt = vi.fn();

        const result = await continuityManager.generateSceneFramesBatch(project, 'scene_start_frame', saveAssets, updateScene, onAttempt);

        expect(storageManager.fileExists).toHaveBeenCalled();
        expect(frameComposer.generateImage).not.toHaveBeenCalled();
        expect(saveAssets).toHaveBeenCalled(); // Should call saveAssets even if existing, to register in DB? Wait, source calls saveAssets if frameExists
        expect(result.data.updatedScenes).toHaveLength(1);
    });

    it('should generate frames if they do not exist in storage', async () => {
        const scenes: Scene[] = [
            {
                id: '2',
                startTime: 5,
                endTime: 10,
                duration: 5,
                description: 'Scene 2',
                characters: [],
                locationId: 'loc1',
                lighting: 'day',
                mood: 'sad',
                assets: {},
                location: 'loc1',
                // ... other required props
            } as any
        ];

        const project: Project = {
            id: 'proj1',
            metadata: {} as any,
            scenes,
            characters: [],
            locations: [ { id: 'loc1', name: 'Test Location', assets: {} } as any ]
        } as any;

        // Mock fileExists to return false
        vi.spyOn(storageManager, 'fileExists').mockResolvedValue(false);
        mockAssetManager.getNextVersionNumber.mockResolvedValue([ 1 ]);

        // Mock prompt generation
        (continuityManager as any).frameComposer.generateFrameGenerationPrompt = vi.fn().mockResolvedValue('prompt');

        const saveAssets = vi.fn();
        const updateScene = vi.fn();
        const onAttempt = vi.fn();

        const result = await continuityManager.generateSceneFramesBatch(project, 'scene_start_frame', saveAssets, updateScene, onAttempt);

        expect(storageManager.fileExists).toHaveBeenCalled();
        expect(frameComposer.generateImage).toHaveBeenCalled();
    });
});
