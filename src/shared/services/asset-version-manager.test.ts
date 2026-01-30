import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssetVersionManager } from './asset-version-manager.js';
import { ProjectRepository } from './project-repository.js';
import { Scope, AssetKey, AssetType } from '../types/index.js';

vi.mock('./project-repository.js');

describe('AssetVersionManager', () => {
    let assetVersionManager: AssetVersionManager;
    let mockProjectRepo: any;

    beforeEach(() => {
        mockProjectRepo = {
            getScene: vi.fn(),
            getProjectCharacters: vi.fn(),
            getProjectLocations: vi.fn(),
            getProject: vi.fn(),
            updateSceneAssets: vi.fn(),
            updateCharacterAssets: vi.fn(),
            updateLocationAssets: vi.fn(),
            updateProjectAssets: vi.fn(),
        };
        assetVersionManager = new AssetVersionManager(mockProjectRepo as any);
    });

    describe('createVersionedAssets', () => {
        it('should create a new version for a scene scope', async () => {
            const scope: Scope = { projectId: 'p1', sceneId: 's1' };
            const assetKey: AssetKey = 'scene_video';
            const type: AssetType = 'video';
            const dataList = [ 'gs://bucket/video.mp4' ];
            const metadata = { model: 'test-model', jobId: 'j1' };

            mockProjectRepo.getScene.mockResolvedValue({
                id: 's1',
                assets: {}
            });

            const versions = await assetVersionManager.createVersionedAssets(
                scope,
                assetKey,
                type,
                dataList,
                metadata,
                true
            );

            expect(versions).toHaveLength(1);
            expect(versions[ 0 ].version).toBe(1);
            expect(versions[ 0 ].data).toBe('gs://bucket/video.mp4');
            expect(mockProjectRepo.updateSceneAssets).toHaveBeenCalledWith(
                's1',
                assetKey,
                expect.objectContaining({
                    head: 1,
                    best: 1,
                    versions: expect.arrayContaining([ versions[ 0 ] ])
                })
            );
        });

        it('should increment version if history already exists', async () => {
            const scope: Scope = { projectId: 'p1', sceneId: 's1' };
            const assetKey: AssetKey = 'scene_video';
            const type: AssetType = 'video';
            const dataList = [ 'gs://bucket/video-v2.mp4' ];
            const metadata = { model: 'test-model', jobId: 'j2' };

            mockProjectRepo.getScene.mockResolvedValue({
                id: 's1',
                assets: {
                    [ assetKey ]: {
                        head: 1,
                        best: 1,
                        versions: [ { version: 1, data: 'gs://bucket/video-v1.mp4', type: 'video', metadata: {}, createdAt: new Date() } ]
                    }
                }
            });

            const versions = await assetVersionManager.createVersionedAssets(
                scope,
                assetKey,
                type,
                dataList,
                metadata,
                true
            );

            expect(versions[ 0 ].version).toBe(2);
            expect(mockProjectRepo.updateSceneAssets).toHaveBeenCalledWith(
                's1',
                assetKey,
                expect.objectContaining({
                    head: 2,
                    best: 2
                })
            );
        });

        it('should handle character scope (multiple entities)', async () => {
            const scope: Scope = { projectId: 'p1', characterIds: [ 'c1', 'c2' ] };
            const assetKey: AssetKey = 'character_image';
            const type: AssetType = 'image';
            const dataList = [ 'gs://bucket/c1.png', 'gs://bucket/c2.png' ];
            const metadata = { model: 'test-model', jobId: 'j3' };

            mockProjectRepo.getProjectCharacters.mockResolvedValue([
                { id: 'c1', assets: {} },
                { id: 'c2', assets: {} }
            ]);

            const versions = await assetVersionManager.createVersionedAssets(
                scope,
                assetKey,
                type,
                dataList,
                metadata,
                true
            );

            expect(versions).toHaveLength(2);
            expect(versions[ 0 ].version).toBe(1);
            expect(versions[ 1 ].version).toBe(1);
            expect(mockProjectRepo.updateCharacterAssets).toHaveBeenCalledTimes(2);
            expect(mockProjectRepo.updateCharacterAssets).toHaveBeenCalledWith('c1', assetKey, expect.any(Object));
            expect(mockProjectRepo.updateCharacterAssets).toHaveBeenCalledWith('c2', assetKey, expect.any(Object));
        });
    });

    describe('setBestVersion', () => {
        it('should update best version for a project scope', async () => {
            const scope: Scope = { projectId: 'p1' };
            const assetKey: AssetKey = 'storyboard';

            mockProjectRepo.getProject.mockResolvedValue({
                id: 'p1',
                assets: {
                    [ assetKey ]: {
                        head: 5,
                        best: 1,
                        versions: [
                            { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }
                        ].map(v => ({ ...v, data: '', type: 'json', metadata: {}, createdAt: new Date() }))
                    }
                }
            });

            await assetVersionManager.setBestVersion(scope, assetKey, [ 3 ]);

            expect(mockProjectRepo.updateProjectAssets).toHaveBeenCalledWith(
                'p1',
                assetKey,
                expect.objectContaining({
                    best: 3
                })
            );
        });
    });
});
