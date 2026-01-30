import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioProcessingAgent } from '../../shared/agents/audio-processing-agent.js';
import { GCPStorageManager } from '../../shared/services/storage-manager.js';
import { TextModelController } from '../../shared/llm/text-model-controller.js';
import ffmpeg from 'fluent-ffmpeg';

vi.mock('fluent-ffmpeg', () => ({
  default: {
    ffprobe: vi.fn(),
  },
}));

// Mock GCPStorageManager to prevent permission checks in constructor
vi.mock('../storage-manager', () => {
  return {
    GCPStorageManager: vi.fn().mockImplementation(function () {
      return {
        getGcsUrl: vi.fn().mockReturnValue('gs://bucket/audio/audio.mp3'),
        getPublicUrl: vi.fn().mockReturnValue('https://storage.googleapis.com/bucket/audio/audio.mp3'),
        uploadFile: vi.fn().mockResolvedValue('gs://bucket/audio/audio.mp3'),
        fileExists: vi.fn().mockResolvedValue(false),
        getObjectPath: vi.fn().mockReturnValue('path'),
      };
    }),
  };
});

describe('AudioProcessingAgent', () => {
  let audioProcessingAgent: AudioProcessingAgent;
  let storageManager: GCPStorageManager;
  let genAI: TextModelController;

  beforeEach(() => {
    (ffmpeg as any).ffprobe.mockImplementation((filePath: any, callback: any) => {
      callback(null, { format: { duration: 120 } });
    });
    storageManager = new GCPStorageManager('project-id', 'video-id', 'bucket-name');
    genAI = {
      generateContent: vi.fn(),
      countTokens: vi.fn().mockResolvedValue({ totalTokens: 100 }),
    } as unknown as TextModelController;
    const mediaController = {
      getAudioDuration: vi.fn().mockResolvedValue(120),
    } as any;
    audioProcessingAgent = new AudioProcessingAgent(genAI, storageManager, mediaController);
  });

  it('should process audio to storyboard', async () => {
    const localAudioPath = '/path/to/audio.mp3';
    const audioGcsUri = 'gs://bucket-name/audio/audio.mp3';
    const mockAnalysis = {
      segments: [ {
        startTime: 0,
        endTime: 120,
        type: 'instrumental',
        lyrics: '',
        musicalDescription: 'A mock description',
        intensity: 'medium',
        mood: 'calm',
        tempo: 'moderate',
        musicChange: 'none',
        musicalChange: 'none',
        transitionType: 'Dissolve',
        transientImpact: 'soft',
        audioEvidence: 'clear transient',
      } ],
      totalDuration: 120,
    };
    const enhancedPrompt = 'A creative prompt.';

    vi.spyOn(storageManager, 'getGcsUrl').mockReturnValue(audioGcsUri);
    vi.spyOn(storageManager, 'fileExists').mockResolvedValue(false);
    vi.spyOn(storageManager, 'uploadFile').mockResolvedValue(audioGcsUri);
    vi.spyOn(genAI, 'generateContent').mockResolvedValue({
      candidates: [ {
        content: {
          parts: [ { text: JSON.stringify(mockAnalysis) } ],
        },
      } ],
    } as any);

    const result = await audioProcessingAgent.processAudioToScenes(localAudioPath, enhancedPrompt);

    expect(result).toEqual(mockAnalysis);
    // expect(storageManager.uploadFile).toHaveBeenCalledWith(localAudioPath, 'audio/audio.mp3'); // Upload removed from agent
    expect(genAI.generateContent).toHaveBeenCalled();
  });

  // it('should skip upload if file exists', async () => { ... }) - Test removed as upload logic is moved out

  it('should throw an error if LLM analysis fails', async () => {
    const localAudioPath = '/path/to/audio.mp3';
    const audioGcsUri = 'gs://bucket-name/audio/audio.mp3';
    const enhancedPrompt = 'A creative prompt.';

    vi.spyOn(storageManager, 'getGcsUrl').mockReturnValue(audioGcsUri);
    // vi.spyOn(storageManager, 'fileExists').mockResolvedValue(false);
    // vi.spyOn(storageManager, 'uploadFile').mockResolvedValue(audioGcsUri);
    vi.spyOn(genAI, 'generateContent').mockResolvedValue({
      candidates: [],
    } as any);

    await expect(audioProcessingAgent.processAudioToScenes(localAudioPath, enhancedPrompt)).rejects.toThrow('No valid analysis result from LLM');
  });

  it('should throw an error if result is null', async () => {
    const localAudioPath = '/path/to/audio.mp3';
    const audioGcsUri = 'gs://bucket-name/audio/audio.mp3';
    const enhancedPrompt = 'A creative prompt.';

    vi.spyOn(storageManager, 'getGcsUrl').mockReturnValue(audioGcsUri);
    vi.spyOn(genAI, 'generateContent').mockResolvedValue(null as any);

    await expect(audioProcessingAgent.processAudioToScenes(localAudioPath, enhancedPrompt)).rejects.toThrow('No valid analysis result from LLM');
  });

  it('should throw an error if candidates are missing', async () => {
    const localAudioPath = '/path/to/audio.mp3';
    const audioGcsUri = 'gs://bucket-name/audio/audio.mp3';
    const enhancedPrompt = 'A creative prompt.';

    vi.spyOn(storageManager, 'getGcsUrl').mockReturnValue(audioGcsUri);
    vi.spyOn(genAI, 'generateContent').mockResolvedValue({} as any);

    await expect(audioProcessingAgent.processAudioToScenes(localAudioPath, enhancedPrompt)).rejects.toThrow('No valid analysis result from LLM');
  });

  it('should throw an error if genAI.models.generateContent throws', async () => {
    const localAudioPath = '/path/to/audio.mp3';
    const audioGcsUri = 'gs://bucket-name/audio/audio.mp3';
    const errorMessage = 'genAI error';
    const enhancedPrompt = 'A creative prompt.';

    vi.spyOn(storageManager, 'getGcsUrl').mockReturnValue(audioGcsUri);
    // vi.spyOn(storageManager, 'fileExists').mockResolvedValue(false);
    // vi.spyOn(storageManager, 'uploadFile').mockResolvedValue(audioGcsUri);
    vi.spyOn(genAI, 'generateContent').mockRejectedValue(new Error(errorMessage));

    await expect(audioProcessingAgent.processAudioToScenes(localAudioPath, enhancedPrompt)).rejects.toThrow(errorMessage);
  });


});
