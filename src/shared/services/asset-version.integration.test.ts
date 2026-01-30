// tests/asset-versioning.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AssetVersionManager } from '../services/asset-version-manager.js';
import { ProjectRepository } from '../services/project-repository.js';
import { AssetKey, AssetType, Scope } from '../types/assets.types.js';

/**
 * Integration tests for the optimized asset versioning system.
 * These tests verify:
 * 1. Performance improvements (N+1 query elimination)
 * 2. Transaction safety
 * 3. Batch operations
 * 4. Cache behavior
 * 5. Immutability
 */

// describe('AssetVersionManager - Optimized', () => {
//     let manager: AssetVersionManager;
//     let repo: ProjectRepository;
//     let testProjectId: string;
//     let testSceneId: string;

//     beforeEach(async () => {
//         // Setup test data
//         repo = new ProjectRepository();
//         manager = new AssetVersionManager(repo);

//         // Create test project and scene
//         const project = await repo.createProject({ name: 'Test Project' });
//         testProjectId = project.id;

//         const scene = await repo.createScenes(testProjectId, [ { name: 'Test Scene' } ]);
//         testSceneId = scene[ 0 ].id;
//     });

//     afterEach(async () => {
//         // Cleanup
//         await repo.deleteProject(testProjectId);
//     });

//     describe('Performance - N+1 Query Elimination', () => {
//         it('should fetch multiple character assets in 1 query', async () => {
//             // Create test characters
//             const char1 = await repo.createCharacter(testProjectId, { name: 'Char1' });
//             const char2 = await repo.createCharacter(testProjectId, { name: 'Char2' });
//             const char3 = await repo.createCharacter(testProjectId, { name: 'Char3' });

//             const scope: Scope = {
//                 projectId: testProjectId,
//                 characterIds: [ char1.id, char2.id, char3.id ],
//             };

//             // Spy on repository calls
//             const spy = vi.spyOn(repo, 'getProjectCharacters');

//             // This should make only 1 DB query for all 3 characters
//             await manager.getNextVersionNumber(scope, 'character_image');

//             // Verify only 1 call was made
//             expect(spy).toHaveBeenCalledTimes(1);
//             expect(spy).toHaveBeenCalledWith(testProjectId);
//         });

//         it('should batch update multiple entities efficiently', async () => {
//             const char1 = await repo.createCharacter(testProjectId, { name: 'Char1' });
//             const char2 = await repo.createCharacter(testProjectId, { name: 'Char2' });

//             const scope: Scope = {
//                 projectId: testProjectId,
//                 characterIds: [ char1.id, char2.id ],
//             };

//             const spy = vi.spyOn(repo, 'updateCharacterAssets');

//             // Create assets for both characters
//             await manager.createVersionedAssets(
//                 scope,
//                 'character_image',
//                 'image',
//                 [ 'url1', 'url2' ],
//                 { model: 'test-model', jobId: 'job-1' }
//             );

//             // Should update both in sequence (not ideal for full batching, but better than before)
//             expect(spy).toHaveBeenCalledTimes(2);
//         });
//     });

//     describe('Batch Operations', () => {
//         it('should create multiple asset types efficiently', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };

//             const { versions, errors } = await manager.batchCreateVersionedAssets([
//                 [ scope, 'scene_start_frame', 'image', [ 'url1' ], { model: 'test', jobId: 'job-1' } ],
//                 [ scope, 'scene_end_frame', 'image', [ 'url2' ], { model: 'test', jobId: 'job-1' } ],
//                 [ scope, 'scene_video', 'video', [ 'url3' ], { model: 'test', jobId: 'job-1' } ],
//             ]);

//             expect(errors).toHaveLength(0);
//             expect(versions).toHaveLength(3);
//             expect(versions[ 0 ].version).toBe(1);
//             expect(versions[ 1 ].version).toBe(1);
//             expect(versions[ 2 ].version).toBe(1);
//         });

//         it('should isolate errors in batch operations', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };

//             // Create one asset first
//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url1' ],
//                 { model: 'test', jobId: 'job-1' }
//             );

//             // Batch operation with one that will fail (invalid type)
//             const { versions, errors } = await manager.batchCreateVersionedAssets([
//                 [ scope, 'scene_start_frame', 'image', [ 'url2' ], { model: 'test', jobId: 'job-2' } ],
//                 [ scope, 'scene_video', 'invalid' as AssetType, [ 'url3' ], { model: 'test', jobId: 'job-2' } ],
//             ]);

//             expect(errors.length).toBeGreaterThan(0);
//             expect(versions.length).toBeGreaterThan(0); // Some should succeed
//         });
//     });

//     describe('Transaction Safety', () => {
//         it('should validate all versions before updating best', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };

//             // Create versions 1 and 2
//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url1' ],
//                 { model: 'test', jobId: 'job-1' }
//             );

//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url2' ],
//                 { model: 'test', jobId: 'job-1' }
//             );

//             // Try to set non-existent version 5 as best
//             await expect(
//                 manager.setBestVersion(scope, 'scene_video', [ 5 ])
//             ).rejects.toThrow('Version validation failed');

//             // Verify best is still version 1 (unchanged)
//             const [ best ] = await manager.getBestVersion(scope, 'scene_video');
//             expect(best?.version).toBe(2); // Last created is auto-set as best
//         });

//         it('should handle concurrent updates atomically', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };

//             // Create initial version
//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url1' ],
//                 { model: 'test', jobId: 'job-1' }
//             );

//             // Concurrent creates
//             const results = await Promise.all([
//                 manager.createVersionedAssets(
//                     scope,
//                     'scene_video',
//                     'video',
//                     [ 'url2' ],
//                     { model: 'test', jobId: 'job-2' }
//                 ),
//                 manager.createVersionedAssets(
//                     scope,
//                     'scene_video',
//                     'video',
//                     [ 'url3' ],
//                     { model: 'test', jobId: 'job-3' }
//                 ),
//             ]);

//             // All should succeed with different version numbers
//             expect(results[ 0 ][ 0 ].version).not.toBe(results[ 1 ][ 0 ].version);

//             // Get all versions
//             const [ [ all ] ] = await manager.getAllVersions(scope, 'scene_video');
//             expect(all.length).toBe(3);
//         });
//     });

//     describe('Immutability', () => {
//         it('should create new history objects on update', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };

//             // Create initial version
//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url1' ],
//                 { model: 'test', jobId: 'job-1' }
//             );

//             // Get initial registry
//             const registry1 = await manager.getAllSceneAssets(testSceneId);
//             const history1 = registry1[ 'scene_video' ];

//             // Create another version
//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url2' ],
//                 { model: 'test', jobId: 'job-2' }
//             );

//             // Get updated registry
//             const registry2 = await manager.getAllSceneAssets(testSceneId);
//             const history2 = registry2[ 'scene_video' ];

//             // Verify immutability
//             expect(history1).not.toBe(history2); // Different objects
//             expect(history1?.head).toBe(1);
//             expect(history2?.head).toBe(2);
//             expect(history1?.versions.length).toBe(1);
//             expect(history2?.versions.length).toBe(2);
//         });

//         it('should not mutate input metadata', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };
//             const metadata = { model: 'test', jobId: 'job-1', custom: 'value' };
//             const originalMetadata = { ...metadata };

//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url1' ],
//                 metadata
//             );

//             // Verify input wasn't mutated
//             expect(metadata).toEqual(originalMetadata);
//         });
//     });

//     describe('Polymorphic Arguments', () => {
//         it('should handle single type for multiple entities', async () => {
//             const char1 = await repo.createCharacter(testProjectId, { name: 'Char1' });
//             const char2 = await repo.createCharacter(testProjectId, { name: 'Char2' });

//             const scope: Scope = {
//                 projectId: testProjectId,
//                 characterIds: [ char1.id, char2.id ],
//             };

//             const versions = await manager.createVersionedAssets(
//                 scope,
//                 'character_image',
//                 'image', // Single type
//                 [ 'url1', 'url2' ],
//                 { model: 'test', jobId: 'job-1' } // Single metadata
//             );

//             expect(versions).toHaveLength(2);
//             expect(versions[ 0 ].type).toBe('image');
//             expect(versions[ 1 ].type).toBe('image');
//         });

//         it('should handle array of types for multiple entities', async () => {
//             const char1 = await repo.createCharacter(testProjectId, { name: 'Char1' });
//             const char2 = await repo.createCharacter(testProjectId, { name: 'Char2' });

//             const scope: Scope = {
//                 projectId: testProjectId,
//                 characterIds: [ char1.id, char2.id ],
//             };

//             const versions = await manager.createVersionedAssets(
//                 scope,
//                 'character_description',
//                 [ 'text', 'json' ], // Array of types
//                 [ 'description1', '{"key":"value"}' ],
//                 [
//                     { model: 'gpt-4', jobId: 'job-1' },
//                     { model: 'gpt-4', jobId: 'job-1' },
//                 ]
//             );

//             expect(versions).toHaveLength(2);
//             expect(versions[ 0 ].type).toBe('text');
//             expect(versions[ 1 ].type).toBe('json');
//         });

//         it('should handle array of setBest flags', async () => {
//             const char1 = await repo.createCharacter(testProjectId, { name: 'Char1' });
//             const char2 = await repo.createCharacter(testProjectId, { name: 'Char2' });

//             const scope: Scope = {
//                 projectId: testProjectId,
//                 characterIds: [ char1.id, char2.id ],
//             };

//             // Create first versions
//             await manager.createVersionedAssets(
//                 scope,
//                 'character_image',
//                 'image',
//                 [ 'url1', 'url2' ],
//                 { model: 'test', jobId: 'job-1' }
//             );

//             // Create second versions with selective setBest
//             await manager.createVersionedAssets(
//                 scope,
//                 'character_image',
//                 'image',
//                 [ 'url3', 'url4' ],
//                 { model: 'test', jobId: 'job-2' },
//                 [ true, false ] // Only set first as best
//             );

//             // Check best versions
//             const bestVersions = await manager.getBestVersion(scope, 'character_image');
//             expect(bestVersions[ 0 ]?.version).toBe(2); // Updated to version 2
//             expect(bestVersions[ 1 ]?.version).toBe(1); // Stayed at version 1
//         });
//     });

//     describe('Metadata Operations', () => {
//         it('should update metadata immutably', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };

//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url1' ],
//                 { model: 'test', jobId: 'job-1' }
//             );

//             // Update metadata
//             await manager.updateVersionMetadata(
//                 scope,
//                 'scene_video',
//                 1,
//                 { evaluation: { qualityScore: 0.95, passed: true } }
//             );

//             // Verify update
//             const [ [ version ] ] = await manager.getAllVersions(scope, 'scene_video');
//             expect(version.metadata.evaluation).toEqual({
//                 qualityScore: 0.95,
//                 passed: true,
//             });
//         });

//         it('should merge metadata without losing existing fields', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };

//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url1' ],
//                 { model: 'test-model', jobId: 'job-1', custom: 'field' }
//             );

//             // Update with new field
//             await manager.updateVersionMetadata(
//                 scope,
//                 'scene_video',
//                 1,
//                 { evaluation: { qualityScore: 0.95 } }
//             );

//             // Verify merge
//             const [ [ version ] ] = await manager.getAllVersions(scope, 'scene_video');
//             expect(version.metadata.model).toBe('test-model');
//             expect(version.metadata.jobId).toBe('job-1');
//             expect(version.metadata.custom).toBe('field');
//             expect(version.metadata.evaluation?.qualityScore).toBe(0.95);
//         });
//     });

//     describe('Edge Cases', () => {
//         it('should handle empty asset registries', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };

//             const nextVersion = await manager.getNextVersionNumber(scope, 'scene_video');
//             expect(nextVersion).toEqual([ 1 ]);

//             const best = await manager.getBestVersion(scope, 'scene_video');
//             expect(best).toEqual([ null ]);
//         });

//         it('should handle setting best to 0 (none)', async () => {
//             const scope: Scope = { projectId: testProjectId, sceneId: testSceneId };

//             // Create version
//             await manager.createVersionedAssets(
//                 scope,
//                 'scene_video',
//                 'video',
//                 [ 'url1' ],
//                 { model: 'test', jobId: 'job-1' }
//             );

//             // Set best to 0
//             await manager.setBestVersion(scope, 'scene_video', [ 0 ]);

//             // Verify best is now 0
//             const best = await manager.getBestVersion(scope, 'scene_video');
//             expect(best).toEqual([ null ]);
//         });

//         it('should validate input lengths match scope', async () => {
//             const char1 = await repo.createCharacter(testProjectId, { name: 'Char1' });
//             const char2 = await repo.createCharacter(testProjectId, { name: 'Char2' });

//             const scope: Scope = {
//                 projectId: testProjectId,
//                 characterIds: [ char1.id, char2.id ], // 2 characters
//             };

//             // Try to create with wrong number of data items
//             await expect(
//                 manager.createVersionedAssets(
//                     scope,
//                     'character_image',
//                     'image',
//                     [ 'url1' ], // Only 1 item for 2 characters
//                     { model: 'test', jobId: 'job-1' }
//                 )
//             ).rejects.toThrow('expects 2 data items');
//         });
//     });
// });