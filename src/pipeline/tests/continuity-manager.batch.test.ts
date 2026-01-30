
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContinuityManagerAgent } from '../../shared/agents/continuity-manager.js';
import { GCPStorageManager } from '../../shared/services/storage-manager.js';
import { FrameCompositionAgent } from '../../shared/agents/frame-composition-agent.js';
import { Scene, Project } from '../../shared/types/index.js';
import { TextModelController } from '../../shared/llm/text-model-controller.js';

// Mocks
const mockStorageManager = {
  getObjectPath: vi.fn(),
  fileExists: vi.fn(),
  buildObjectData: vi.fn((uri) => ({ storageUri: uri, publicUri: uri })),
  getLatestAttempt: vi.fn().mockReturnValue(1),
  getGcsUrl: vi.fn(path => `gs://${path}`),
  getPublicUrl: vi.fn(path => `https://${path}`),
};

const mockFrameComposer = {
  generateImage: vi.fn(),
  generateFrameGenerationPrompt: vi.fn().mockResolvedValue('prompt'),
};

const mockLlm = {
  generateContent: vi.fn(),
} as any;
const mockQualityAgent = {} as any;
const mockAssetManager = {
  getNextVersionNumber: vi.fn().mockResolvedValue([ 1 ]),
  getBestVersion: vi.fn().mockResolvedValue([]), // No existing assets
} as any;

describe('ContinuityManagerAgent - generateSceneFramesBatch', () => {
  let continuityAgent: ContinuityManagerAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    continuityAgent = new ContinuityManagerAgent(
      mockLlm,
      mockLlm,
      mockFrameComposer as any,
      mockQualityAgent,
      mockStorageManager as any,
      mockAssetManager
    );
  });

  it('should skip generation if frames already exist in storage', async () => {
    const scenes: Scene[] = [
      { id: '1', characters: [], location: 'loc1', duration: 5, assets: {} } as any,
    ];
    const project: Project = {
      id: 'proj1',
      metadata: {} as any,
      scenes,
      characters: [],
      locations: [ { id: 'loc1', assets: {} } as any ]
    } as any;

    // Mock storage to say start and end frames exist
    mockStorageManager.getObjectPath.mockReturnValue('bucket/start_frame.png');
    mockStorageManager.fileExists.mockResolvedValue(true);

    const saveAssets = vi.fn();
    const updateScene = vi.fn();
    const onAttempt = vi.fn();

    const result = await continuityAgent.generateSceneFramesBatch(project, 'scene_start_frame', saveAssets, updateScene, onAttempt);

    // Should verify file existence
    expect(mockStorageManager.fileExists).toHaveBeenCalled();

    // Should NOT call generateImage
    expect(mockFrameComposer.generateImage).not.toHaveBeenCalled();

    expect(result.data.updatedScenes).toHaveLength(1);
  });

  it('should generate frames if they do not exist in storage', async () => {
    const scenes: Scene[] = [
      { id: '2', characters: [], location: 'loc1', duration: 5, assets: {} } as any,
    ];
    const project: Project = {
      id: 'proj1',
      metadata: {} as any,
      scenes,
      characters: [],
      locations: [ { id: 'loc1', assets: {} } as any ]
    } as any;

    // Mock storage to say frames DO NOT exist
    mockStorageManager.getObjectPath.mockReturnValue('bucket/missing_frame.png');
    mockStorageManager.fileExists.mockResolvedValue(false);

    // Mock generation
    mockFrameComposer.generateImage.mockResolvedValue({ storageUri: 'gs://generated/frame.png' });

    const saveAssets = vi.fn();
    const updateScene = vi.fn();
    const onAttempt = vi.fn();

    const result = await continuityAgent.generateSceneFramesBatch(project, 'scene_start_frame', saveAssets, updateScene, onAttempt);

    // Should verify file existence
    expect(mockStorageManager.fileExists).toHaveBeenCalled();

    // Should call generateImage
    expect(mockFrameComposer.generateImage).toHaveBeenCalled();
  });
});
