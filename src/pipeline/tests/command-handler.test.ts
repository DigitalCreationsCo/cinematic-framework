import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineCommandHandler } from '../services/command-handler';
import { db } from '../../shared/db';

vi.mock('../../shared/db', () => ({
    db: {
        transaction: vi.fn(),
    }
}));

describe('PipelineCommandHandler', () => {
    let mockTx: any;

    beforeEach(() => {
        mockTx = {
            query: {
                scenes: {
                    findFirst: vi.fn()
                }
            },
            update: vi.fn().mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue({})
                })
            }),
            insert: vi.fn().mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([ { id: 'job-1' } ])
                })
            })
        };

        (db.transaction as any).mockImplementation(async (cb: any) => cb(mockTx));
    });

    describe('handleUpdateAsset', () => {
        it('should update existing asset history to set best version', async () => {
            const sceneId = 'scene-1';
            const assetKey = 'scene_video';
            const cmd = { payload: { scene: { id: sceneId }, assetKey, version: 2 } } as any;

            mockTx.query.scenes.findFirst.mockResolvedValue({
                assets: {
                    scene_video: {
                        versions: [{ version: 1 }, { version: 2 }],
                        best: 1
                    }
                }
            });

            await PipelineCommandHandler.handleUpdateAsset(cmd);

            expect(mockTx.update).toHaveBeenCalled();
            // Deep inspection of the update call would be ideal but basic flow verification is good for now
        });

        it('should un-set best version if version is null', async () => {
            const sceneId = 'scene-1';
            const assetKey = 'scene_video';
            const cmd = { payload: { scene: { id: sceneId }, assetKey, version: null } } as any;

            mockTx.query.scenes.findFirst.mockResolvedValue({
                assets: {
                    scene_video: {
                        versions: [{ version: 1 }],
                        best: 1
                    }
                }
            });

            await PipelineCommandHandler.handleUpdateAsset(cmd);
            expect(mockTx.update).toHaveBeenCalled();
        });
    });

    describe('handleRegenerateScene', () => {
        it('should create a job and update project if forceRegenerate is true', async () => {
            const cmd = { 
                projectId: 'proj-1',
                payload: { sceneId: 'scene-1', forceRegenerate: true, promptModification: 'Make it darker' } 
            } as any;

            const job = await PipelineCommandHandler.handleRegenerateScene(cmd);

            expect(mockTx.update).toHaveBeenCalled(); // Project update
            expect(mockTx.insert).toHaveBeenCalled(); // Job creation
            expect(job).toEqual({ id: 'job-1' });
        });

         it('should only create job if forceRegenerate is false', async () => {
            const cmd = { 
                projectId: 'proj-1',
                payload: { sceneId: 'scene-1', forceRegenerate: false } 
            } as any;

            await PipelineCommandHandler.handleRegenerateScene(cmd);

            expect(mockTx.update).not.toHaveBeenCalled(); // No project update
            expect(mockTx.insert).toHaveBeenCalled();
        });
    });
});
