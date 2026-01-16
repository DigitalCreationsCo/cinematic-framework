import { ProjectRepository } from "../pipeline/project-repository";
import { AssetHistory, AssetRegistry, AssetType, AssetVersion, Project, Scene, Character, Location, AssetKey, Scope, CreateVersionedAssetsBaseArgs } from "../shared/types/workflow.types";
import { mapDbProjectToDomain } from "../pipeline/helpers/domain/project-mappers";



export class AssetVersionManager {
    constructor(
        private projectRepo: ProjectRepository,
    ) { }

    /**
     * Registers new attempts/versions of an asset for a list of entities.
     * Atomically increments the version counter and saves to DB.
     * 
     * @param scope - Defines which entities (Project, Scene, Characters, Locations) are being updated.
     * @param assetKey - The type of asset being versioned.
     * @param type - The content type (video, image, text, etc.).
     * @param dataList - An array of data corresponding to the entities in the scope.
     *                   If scope is singular (Project/Scene), this should be an array of length 1.
     *                   If scope is plural (Characters/Locations), it must match the order of IDs.
     * @param metadata - Metadata to attach to the version.
     * @param setBest - Whether to automatically set this new version as "Best".
     */
    async createVersionedAssets(
        ...[ scope, assetKey, type, dataList, metadata, setBest = false ]: CreateVersionedAssetsBaseArgs
    ): Promise<AssetVersion[]> {

        const histories = await this.getAssetHistories(scope, assetKey);
        const count = Math.min(histories.length, dataList.length);

        const newVersions: AssetVersion[] = [];
        const updatedHistories: AssetHistory[] = [];

        for (let i = 0; i < count; i++) {
            const history = histories[ i ];
            const data = dataList[ i ];

            // --- Polymorphic Fallback Logic ---

            // Resolve Type
            let specificType: AssetType;
            if (Array.isArray(type)) {
                specificType = type[ i ];
                if (specificType === undefined) {
                    console.warn(`[AssetManager] 'type' array out of bounds at index ${i}. Falling back to type[0].`);
                    specificType = type[ 0 ];
                }
            } else {
                specificType = type;
            }

            // Resolve Metadata
            let specificMetadata: AssetVersion[ 'metadata' ];
            if (Array.isArray(metadata)) {
                specificMetadata = metadata[ i ];
                if (specificMetadata === undefined) {
                    console.warn(`[AssetManager] 'metadata' array out of bounds at index ${i}. Falling back to metadata[0].`);
                    specificMetadata = metadata[ 0 ];
                }
            } else {
                specificMetadata = metadata;
            }

            // Resolve SetBest
            let specificSetBest: boolean;
            if (Array.isArray(setBest)) {
                specificSetBest = setBest[ i ];
                if (specificSetBest === undefined) {
                    console.warn(`[AssetManager] 'setBest' array out of bounds at index ${i}. Defaulting to false.`);
                    specificSetBest = false;
                }
            } else {
                specificSetBest = setBest;
            }

            // --- Process Version ---

            const newVersionNum = history.head + 1;
            const newVersion: AssetVersion = {
                version: newVersionNum,
                type: specificType,
                data,
                metadata: specificMetadata,
                createdAt: new Date().toISOString()
            };

            history.head = newVersionNum;
            history.versions.push(newVersion);

            if (history.best === 0 || specificSetBest) {
                history.best = newVersionNum;
            }

            newVersions.push(newVersion);
            updatedHistories.push(history);
        }

        await this.saveAssetHistories(scope, assetKey, updatedHistories);
        return newVersions;
    }

    /**
     * Returns the next version number that WILL be created for each entity in scope.
     * Does not modify the DB.
     */
    async getNextVersionNumber(scope: Scope, assetKey: AssetKey): Promise<number[]> {
        const histories = await this.getAssetHistories(scope, assetKey);
        return histories.map(h => h.head + 1);
    }

    /**
     * Returns the "Best" (active) version of an asset for each entity in scope.
     */
    async getBestVersion(scope: Scope, assetKey: AssetKey): Promise<(AssetVersion | null)[]> {
        const histories = await this.getAssetHistories(scope, assetKey);
        return histories.map(h => {
            if (h.best === 0 || !h.versions[ h.best ]) return null;
            return h.versions[ h.best ];
        });
    }

    /**
   * Update best version pointer (based on highest quality score)
   */
    setBestVersionFast(
        registry: AssetRegistry,
        key: AssetKey,
        version: number
    ): void {
        if (registry[ key ] && version <= registry[ key ].head) {
            registry[ key ].best = version;
        }
    }

    /**
     * Updates which version is considered "Best" for each entity in scope.
     * IMPORTANT: Expects `versions` array to match the order of entities.
     */
    async setBestVersion(scope: Scope, assetKey: AssetKey, versions: number[]): Promise<void> {
        const histories = await this.getAssetHistories(scope, assetKey);

        if (histories.length !== versions.length) {
            throw new Error(`Mismatch between scope entities (${histories.length}) and version numbers (${versions.length})`);
        }

        const updatedHistories: AssetHistory[] = [];

        for (let i = 0; i < histories.length; i++) {
            const history = histories[ i ];
            const version = versions[ i ];

            // Allow setting best to 0 (none)
            if (version !== 0 && !history.versions[ version ]) {
                const entityId = this.getEntityIdFromScope(scope, i);
                console.warn(`Version ${version} does not exist for entity ${entityId}`);
                continue; // Or throw?
            }

            history.best = version;
            updatedHistories.push(history);
        }

        await this.saveAssetHistories(scope, assetKey, updatedHistories);
    }

    async getAllSceneAssets(sceneId: string): Promise<AssetRegistry> {
        const scene = await this.projectRepo.getScene(sceneId);
        const assetsMap = scene.assets || {};
        return assetsMap;
    }

    // TODO implement compile error if required scope key is missing
    private async getAssetHistories(scope: Scope, assetKey: AssetKey): Promise<AssetHistory[]> {
        let assetsHistoryList: Partial<Record<AssetKey, AssetHistory>>[] = [];

        if ("sceneId" in scope) {
            const scene = await this.projectRepo.getScene(scope.sceneId);
            assetsHistoryList = [ scene.assets || {} ];
        } else if ("characterIds" in scope) {
            const characters = await this.projectRepo.getProjectCharacters(scope.projectId);
            for (let i = 0; i < scope.characterIds.length; i++) {
                assetsHistoryList.push(characters.find(c => c.id === scope.characterIds[ i ])?.assets || {});
            }
        } else if ("locationIds" in scope) {
            const locations = await this.projectRepo.getProjectLocations(scope.projectId);
            for (let i = 0; i < scope.locationIds.length; i++) {
                assetsHistoryList.push(locations.find(l => l.id === scope.locationIds[ i ])?.assets || {});
            }
        }
        else {
            const project = await this.projectRepo.getProject(scope.projectId);
            assetsHistoryList = [ project.assets || {} ];
        }

        return assetsHistoryList.map(assetsMap => assetsMap[ assetKey ] || { head: 0, best: 0, versions: [] });
    }

    /**
     * Updates asset history for each entity in scope.
     * IMPORTANT: Expects `histories` array to match the order of entities.
     */
    private async saveAssetHistories(scope: Scope, assetKey: AssetKey, histories: AssetHistory[]) {
        if ("sceneId" in scope) {
            if (histories.length !== 1) throw new Error("Expected single history for scene scope");
            const scene = await this.projectRepo.getScene(scope.sceneId);
            const assets = scene.assets || {};
            assets[ assetKey ] = histories[ 0 ];

            const updates: Partial<Scene> = { assets };

            await this.projectRepo.updateScenes([{ ...scene, ...updates }]);

        } else if ("characterIds" in scope) {
            if (histories.length !== scope.characterIds.length) throw new Error("History count mismatch for characters");
            const characters = await this.projectRepo.getCharactersByIds(scope.characterIds);
            const updates: Character[] = characters.map((char, index) => {
                const assets = char.assets || {};
                assets[ assetKey ] = histories[ index ];
                return { ...char, assets };
            });
            await this.projectRepo.updateCharacters(updates);

        } else if ("locationIds" in scope) {
            if (histories.length !== scope.locationIds.length) throw new Error("History count mismatch for locations");
            const locations = await this.projectRepo.getLocationsByIds(scope.locationIds);
            const updates: Location[] = locations.map((loc, index) => {
                const assets = loc.assets || {};
                assets[ assetKey ] = histories[ index ];
                return { ...loc, assets };
            });
            await this.projectRepo.updateLocations(updates);

        } else {
            if (histories.length !== 1) throw new Error("Expected single history for project scope");
            const project = await this.projectRepo.getProject(scope.projectId);
            const assets = project.assets || {};
            assets[ assetKey ] = histories[ 0 ];

            const updates: Partial<Project> = { assets };

            await this.projectRepo.updateProject(scope.projectId, mapDbProjectToDomain({
                project: {
                    ...project,
                ...updates, 
                    assets
                }
            }));
        }
    }

    /**
  * Update version metadata (e.g., add evaluation result)
  */
    updateVersionMetadata(
        registry: AssetRegistry,
        key: AssetKey,
        version: number,
        metadata: Partial<AssetVersion[ 'metadata' ]>
    ): void {
        const versionObj = registry[ key ]?.versions.find(v => v.version === version);
        if (versionObj) {
            versionObj.metadata = { ...versionObj.metadata, ...metadata };
        }
    }

    private getEntityIdFromScope(scope: Scope, index: number): string {
        if ("sceneId" in scope) return scope.sceneId;
        if ("characterIds" in scope) return scope.characterIds[ index ] || "unknown";
        if ("locationIds" in scope) return scope.locationIds[ index ] || "unknown";
        return scope.projectId;
    }
}
