import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VideoGenerationWorker } from '../workers/video-worker';

describe('VideoGenerationWorker', () => {
    let worker: VideoGenerationWorker;
    let mockControlPlane: any;
    let mockProjectRepo: any;
    let mockSceneGenerator: any;

    beforeEach(() => {
        mockControlPlane = {
            updateJobState: vi.fn()
        };
        mockProjectRepo = {
            getProjectFullState: vi.fn()
        };
        mockSceneGenerator = {
            generateSceneWithQualityCheck: vi.fn()
        };

        worker = new VideoGenerationWorker(
            mockControlPlane,
            mockProjectRepo,
            mockSceneGenerator,
            'worker-1'
        );
    });

    it('should process a valid job', async () => {
        const job = { 
            id: 'job-1', 
            type: 'GENERATE_SCENE_VIDEO', 
            projectId: 'p1', 
            payload: { sceneId: 's1', modification: 'darker' } 
        } as any;

        mockProjectRepo.getProjectFullState.mockResolvedValue({
            scenes: [{ 
                id: 's1', 
                locationId: 'l1', 
                characterIds: ['c1'],
                cinematography: { shotType: 'Wide', cameraMovement: 'Static', cameraAngle: 'Eye' }, 
                lighting: { motivatedSources: [] },
                description: 'Test scene',
                mood: 'Happy'
            }],
            characters: [{ id: 'c1', name: 'Char', physicalTraits: { hair: 'Dark', clothing: 'Suit', distinctiveFeatures: [] } }],
            locations: [{ id: 'l1', name: 'Loc', lightingConditions: { hardness: 'Soft' } }]
        });

        mockSceneGenerator.generateSceneWithQualityCheck.mockResolvedValue({
            videoUrl: 'http://video.mp4',
            finalScore: 0.9
        });

        await worker.processJob(job);

        expect(mockSceneGenerator.generateSceneWithQualityCheck).toHaveBeenCalledWith(expect.objectContaining({
            enhancedPrompt: expect.stringContaining('Modification: darker')
        }));

        expect(mockControlPlane.updateJobState).toHaveBeenCalledWith('job-1', 'COMPLETED', expect.objectContaining({
            videoUrl: 'http://video.mp4'
        }));
    });

    it('should fail job on error', async () => {
        const job = { 
            id: 'job-1', 
            type: 'GENERATE_SCENE_VIDEO', 
            projectId: 'p1', 
            payload: { sceneId: 's1' } 
        } as any;

        mockProjectRepo.getProjectFullState.mockRejectedValue(new Error('DB Error'));

        await worker.processJob(job);

        expect(mockControlPlane.updateJobState).toHaveBeenCalledWith('job-1', 'FAILED', undefined, 'DB Error');
    });
});
