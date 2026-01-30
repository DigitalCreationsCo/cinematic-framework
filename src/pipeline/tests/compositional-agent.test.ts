import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock GCPStorageManager to prevent permission checks in constructor
vi.mock('../../shared/services/storage-manager.js', () => {
    return {
        GCPStorageManager: class {
            getObjectPath = vi.fn().mockReturnValue('storyboard.json');
            uploadJSON = vi.fn().mockResolvedValue('gs://bucket-name/storyboard.json');
            uploadFile = vi.fn();
            downloadJSON = vi.fn();
        }
    };
});

// Mock @google/genai module
const mockGenerateContent = vi.fn();

// vi.mock('@google/genai', () => {
//     return {
//         GoogleGenAI: class {
//             models = {
//                 generateContent: mockGenerateContent,
//             };
//         },
//         HarmCategory: { HARM_CATEGORY_UNSPECIFIED: 'HARM_CATEGORY_UNSPECIFIED' },
//         HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH' },
//         HarmBlockMethod: { SEVERITY: 'SEVERITY' },
//         Modality: { TEXT: 'TEXT' },
//     };
// });

// import { CompositionalAgent } from '../../shared/agents/compositional-agent.js';
// import { GCPStorageManager } from '../../shared/services/storage-manager.js';
// import { Storyboard } from '../../shared/types/workflow.types.js';
// import { TextModelController } from '../../shared/llm/text-model-controller.js';
// import { GoogleProvider } from '../../shared/llm/google/provider.js';
// import { GoogleGenAI } from '@google/genai';

// vi.mock('@google/genai', () => {
//     return {
//         GoogleGenAI: class {
//             models = {
//                 generateContent: mockGenerateContent,
//             };
//         },
//         HarmCategory: { HARM_CATEGORY_UNSPECIFIED: 'HARM_CATEGORY_UNSPECIFIED' },
//         HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH' },
//         HarmBlockMethod: { SEVERITY: 'SEVERITY' },
//         Modality: { TEXT: 'TEXT' },
//     };
// });

// describe('CompositionalAgent', () => {
//     let compositionalAgent: CompositionalAgent;
//     let llm: TextModelController;
//     let storageManager: GCPStorageManager;

//     beforeEach(() => {
//         vi.clearAllMocks();

//         llm = new TextModelController();
//         storageManager = new GCPStorageManager('project-id', 'video-id', 'bucket-name');
//         compositionalAgent = new CompositionalAgent(llm, storageManager, {} as any);
//     });

//     it('should generate a storyboard', async () => {
//         const storyboard: Storyboard = {
//             metadata: { title: 'Test Storyboard', duration: 8, totalScenes: 1, style: 'cinematic', mood: 'epic', colorPalette: [ '#ffffff' ], tags: [ 'test' ] } as any,
//             characters: [],
//             locations: [],
//             scenes: [
//                 {
//                     id: 1,
//                     startTime: 0,
//                     endTime: 8,
//                     duration: 8,
//                     description: 'Scene 1',
//                     musicalDescription: 'Scene 1',
//                     type: 'instrumental',
//                     lyrics: '',
//                     musicChange: 'none',
//                     intensity: 'medium',
//                     mood: 'calm',
//                     tempo: 'moderate',
//                     transitionType: 'Dissolve',
//                     shotType: 'wide',
//                     cameraMovement: 'static',
//                     lighting: {
//                         quality: "test",
//                         colorTemperature: "test",
//                         intensity: "test",
//                         motivatedSources: "test",
//                         direction: "test",
//                     },
//                     audioSync: 'mood',
//                     continuityNotes: [],
//                     characters: [],
//                     locationId: 'loc_1',
//                 } as any,
//             ],
//         };
//         const enhancedPrompt = 'A creative prompt.';

//         const mockInitialContext = {
//             metadata: { ...storyboard.metadata, title: 'Enriched Storyboard' },
//             characters: [],
//             locations: [],
//         };

//         const mockEnrichedScenes = {
//             scenes: [
//                 { ...storyboard.scenes[ 0 ], description: 'Enriched Scene 1' },
//             ],
//         };

//         mockGenerateContent
//             .mockResolvedValueOnce({ text: JSON.stringify(mockInitialContext) } as any)
//             .mockResolvedValueOnce({ text: JSON.stringify(mockEnrichedScenes) } as any);

//         vi.spyOn(storageManager, 'getObjectPath').mockReturnValue('storyboard.json');
//         vi.spyOn(storageManager, 'uploadJSON').mockResolvedValue('gs://bucket-name/storyboard.json');

//         const result = await compositionalAgent.generateFullStoryboard(storyboard, enhancedPrompt, [] as any[], {} as any, {} as any);

//         expect(result.data.storyboardAttributes.metadata.title).toBe('Enriched Storyboard');
//         expect(result.data.storyboardAttributes.scenes[ 0 ].description).toBe('Enriched Scene 1');
//         expect(storageManager.uploadJSON).toHaveBeenCalled();
//     }, 8000);

//     it('should handle batching correctly', async () => {
//         const scenes = Array.from({ length: 15 }, (_, i) => ({
//             id: i + 1,
//             startTime: i * 8,
//             endTime: (i + 1) * 8,
//             duration: 8 as const,
//             musicalDescription: 'Scene 1',
//             description: `Scene ${i + 1}`,
//             type: 'instrumental' as const,
//             lyrics: '',
//             musicChange: 'none' as const,
//             intensity: 'medium' as const,
//             mood: 'calm' as const,
//             tempo: 'moderate' as const,
//             transitionType: 'Dissolve' as const,
//             shotType: 'wide',
//             cameraMovement: 'static',
//             lighting: {
//                 quality: "test",
//                 colorTemperature: "test",
//                 intensity: "test",
//                 motivatedSources: "test",
//                 direction: "test",
//             },
//             audioSync: 'mood',
//             continuityNotes: [],
//             characters: [],
//             locationId: 'loc_1',
//         }));

//         const storyboard: Storyboard = {
//             metadata: { title: 'Test Storyboard', duration: 120, totalScenes: 15, style: 'cinematic', mood: 'epic', colorPalette: [ '#ffffff' ], tags: [ 'test' ] },
//             characters: [],
//             locations: [],
//             scenes,
//         };
//         const enhancedPrompt = 'A creative prompt.';

//         mockGenerateContent
//             .mockResolvedValueOnce({ text: JSON.stringify({ metadata: storyboard.metadata, characters: [], locations: [] }) } as any)
//             .mockResolvedValueOnce({ text: JSON.stringify({ scenes: scenes.slice(0, 10) }) } as any)
//             .mockResolvedValueOnce({ text: JSON.stringify({ scenes: scenes.slice(10, 15) }) } as any);
//         vi.spyOn(storageManager, 'getObjectPath').mockReturnValue('storyboard.json');
//         vi.spyOn(storageManager, 'uploadJSON').mockResolvedValue('gs://bucket-name/storyboard.json');

//         await compositionalAgent.generateFullStoryboard(storyboard, enhancedPrompt);

//         expect(mockGenerateContent).toHaveBeenCalledTimes(3);
//     }, 12000);

//     it('should handle rate limiting with retries', async () => {
//         const storyboard: Storyboard = {
//             metadata: { title: 'Test Storyboard', duration: 8, totalScenes: 1, style: 'cinematic', mood: 'epic', colorPalette: [ '#ffffff' ], tags: [ 'test' ] },
//             characters: [],
//             locations: [],
//             scenes: [
//                 {
//                     id: 1,
//                     startTime: 0,
//                     endTime: 8,
//                     duration: 8,
//                     musicalDescription: 'Scene 1',
//                     description: 'Scene 1',
//                     type: 'instrumental',
//                     lyrics: '',
//                     musicChange: 'none',
//                     intensity: 'medium',
//                     mood: 'calm',
//                     tempo: 'moderate',
//                     transitionType: 'Dissolve',
//                     shotType: 'wide',
//                     cameraMovement: 'static',
//                     lighting: {
//                         quality: "test",
//                         colorTemperature: "test",
//                         intensity: "test",
//                         motivatedSources: "test",
//                         direction: "test",
//                     },
//                     audioSync: 'mood',
//                     continuityNotes: [],
//                     characters: [],
//                     locationId: 'loc_1',
//                 },
//             ],
//         };
//         const enhancedPrompt = 'A creative prompt.';

//         const mockInitialContext = {
//             metadata: storyboard.metadata,
//             characters: [],
//             locations: [],
//         };

//         mockGenerateContent
//             .mockRejectedValueOnce({ status: 429 }) // Fail initial context once
//             .mockResolvedValueOnce({ text: JSON.stringify(mockInitialContext) } as any) // Succeed initial context
//             .mockResolvedValueOnce({ text: JSON.stringify({ scenes: storyboard.scenes }) } as any); // Succeed scene batch

//         vi.spyOn(storageManager, 'getObjectPath').mockReturnValue('storyboard.json');
//         vi.spyOn(storageManager, 'uploadJSON').mockResolvedValue('gs://bucket-name/storyboard.json');

//         await compositionalAgent.generateFullStoryboard(storyboard, enhancedPrompt, { maxRetries: 2, initialDelay: 1000 });

//         expect(mockGenerateContent).toHaveBeenCalledTimes(3);
//     }, 30000);

//     it('should throw an error after max retries', async () => {
//         const storyboard: Storyboard = {
//             metadata: { title: 'Test Storyboard', duration: 8, totalScenes: 1, style: 'cinematic', mood: 'epic', colorPalette: [ '#ffffff' ], tags: [ 'test' ] },
//             characters: [],
//             locations: [],
//             scenes: [
//                 {
//                     id: 1,
//                     startTime: 0,
//                     endTime: 8,
//                     duration: 8,
//                     musicalDescription: 'Scene 1',
//                     description: 'Scene 1',
//                     type: 'instrumental',
//                     lyrics: '',
//                     musicChange: 'none',
//                     intensity: 'medium',
//                     mood: 'calm',
//                     tempo: 'moderate',
//                     transitionType: 'Dissolve',
//                     shotType: 'wide',
//                     cameraMovement: 'static',
//                     lighting: {
//                         quality: "test",
//                         colorTemperature: "test",
//                         intensity: "test",
//                         motivatedSources: "test",
//                         direction: "test",
//                     },
//                     audioSync: 'mood',
//                     continuityNotes: [],
//                     characters: [],
//                     locationId: 'loc_1',
//                 },
//             ],
//         };
//         const enhancedPrompt = 'A creative prompt.';

//         mockGenerateContent.mockRejectedValue(new Error('LLM call failed after multiple retries.'));
//         vi.spyOn(storageManager, 'getObjectPath').mockReturnValue('storyboard.json');
//         vi.spyOn(storageManager, 'uploadJSON').mockResolvedValue('gs://bucket-name/storyboard.json');

//         await expect(compositionalAgent.generateFullStoryboard(storyboard, enhancedPrompt, { maxRetries: 3, initialDelay: 10 })).rejects.toThrow('LLM call failed after multiple retries.');
//     }, 15000);

//     it('should expand creative prompt', async () => {
//         const title = 'Test Storyboard';
//         const prompt = 'A short prompt';
//         const expandedPrompt = 'A longer, more detailed prompt';
//         const projectId = 'test-project-id';

//         mockGenerateContent.mockResolvedValueOnce({
//             text: expandedPrompt,
//         } as any);

//         const result = await compositionalAgent.expandCreativePrompt(title, prompt, { maxRetries: 3, attempt: 1, initialDelay: 1000, projectId: projectId });
//         expect(result).toBe(expandedPrompt);
//         expect(mockGenerateContent).toHaveBeenCalled();
//     }, 150000);

//     it('should return original prompt if expansion fails', async () => {
//         const title = 'Test Storyboard';
//         const prompt = 'A short prompt';
//         const projectId = 'test-project-id';

//         mockGenerateContent.mockRejectedValueOnce(new Error('Failed'));

//         const result = await compositionalAgent.expandCreativePrompt(title, prompt, { maxRetries: 3, attempt: 1, initialDelay: 1000, projectId: projectId });
//         expect(result).toBe(prompt);
//     });

//     it('should generate storyboard from prompt', async () => {
//         const initialPrompt = 'A short prompt';
//         const enhancedPrompt = 'A creative prompt';
//         const projectId = 'test-project-id';
//         const mockStoryboard: Storyboard = {
//             metadata: {
//                 title: 'Test Storyboard',
//                 duration: 8,
//                 totalScenes: 1,
//                 style: 'cinematic',
//                 mood: 'epic',
//                 colorPalette: [ '#ffffff' ],
//                 tags: [ 'test' ],
//                 enhancedPrompt: enhancedPrompt,
//                 projectId,
//                 models: {
//                     videoModel: 'veo-2.0-generate-exp',
//                     imageModel: 'imagen-3',
//                     textModel: 'gemini-2.5-flash',
//                     qualityCheckModel: 'gemini-2.5-flash',
//                 },
//                 initialPrompt,
//                 hasAudio: true,
//             } as Storyboard[ 'metadata' ],
//             characters: [],
//             locations: [],
//             scenes: [
//                 {
//                     id: 1,
//                     startTime: 0,
//                     endTime: 8,
//                     duration: 8,
//                     musicalDescription: 'Scene 1',
//                     description: 'Scene 1',
//                     type: 'instrumental',
//                     lyrics: '',
//                     musicChange: 'none',
//                     intensity: 'medium',
//                     mood: 'calm',
//                     tempo: 'moderate',
//                     transitionType: 'Dissolve',
//                     shotType: 'wide',
//                     cameraMovement: 'static',
//                     lighting: {
//                         quality: "test",
//                         colorTemperature: "test",
//                         intensity: "test",
//                         motivatedSources: "test",
//                         direction: "test",
//                     },
//                     audioSync: 'mood',
//                     continuityNotes: [],
//                     characters: [],
//                     locationId: 'loc_1',
//                 },
//             ],
//         };

//         mockGenerateContent.mockResolvedValueOnce({
//             text: JSON.stringify(mockStoryboard),
//         } as any);
//         vi.spyOn(storageManager, 'getObjectPath').mockReturnValue('storyboard.json');
//         vi.spyOn(storageManager, 'uploadJSON').mockResolvedValue('gs://bucket-name/storyboard.json');

//         const result = await compositionalAgent.generateStoryboardExclusivelyFromPrompt(enhancedPrompt);
//         expect(result).toEqual(mockStoryboard);
//         expect(storageManager.uploadJSON).toHaveBeenCalled();
//     });
// });
