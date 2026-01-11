import { ProjectRepository } from "../pipeline/project-repository";
import { AssetHistory, AssetRegistry, AssetType, AssetVersion, Project, Scene, Character, Location, AssetKey } from "../shared/types/pipeline.types";
import { mapDbProjectToDomain } from "../pipeline/helpers/domain/project-mappers";

export type Scope = {
    projectId: string;
} | {
    projectId: string;
    sceneId: string;
} | {
    projectId: string;
    characterIds: string[];
} | {
    projectId: string;
    locationIds: string[];
};

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
        scope: Scope,
        assetKey: AssetKey,
        type: AssetType,
        dataList: string[],
        metadata: AssetVersion[ 'metadata' ],
        setBest = false,
    ): Promise<AssetVersion[]> {
        const histories = await this.getAssetHistories(scope, assetKey);

        if (histories.length !== dataList.length) {
            console.warn(`[AssetManager] Mismatch between scope entities (${histories.length}) and data items (${dataList.length}) for ${assetKey}.`);
        }

        const newVersions: AssetVersion[] = [];
        const updatedHistories: AssetHistory[] = [];

        // Iterate safely
        const count = Math.min(histories.length, dataList.length);

        for (let i = 0; i < count; i++) {
            const history = histories[ i ];
            const data = dataList[ i ];

            const newVersionNum = history.head + 1;
            const newVersion: AssetVersion = {
                version: newVersionNum,
                type,
                data,
                metadata,
                createdAt: new Date().toISOString()
            };

            // Update history object
            history.head = newVersionNum;
            history.versions[ newVersionNum ] = newVersion;

            // Auto-set best if it's the first one, or if configured to auto-update
            if (history.best === 0 || setBest) {
                history.best = newVersionNum;
            }

            newVersions.push(newVersion);
            updatedHistories.push(history);

            const entityId = this.getEntityIdFromScope(scope, i);
            console.log(`[AssetManager] Created v${newVersionNum} for ${assetKey} (Entity: ${entityId})`);
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
     * Updates which version is considered "Best" for each entity in scope.
     * Expects `versions` array to match the order of entities.
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

    // TODO implement compile error if required scope is missing
    private async getAssetHistories(scope: Scope, assetKey: AssetKey): Promise<AssetHistory[]> {
        let assetsHistoryList: Record<string, AssetHistory>[] = [];

        if ("sceneId" in scope) {
            const scene = await this.projectRepo.getScene(scope.sceneId);
            assetsHistoryList = [ scene.assets || {} ];
        } else if ("characterIds" in scope) {
            const characters = await this.projectRepo.getProjectCharacters(scope.projectId);
            assetsHistoryList = assetsHistoryList = characters.reduce((chars, next) => {
                if (scope.characterIds.includes(next.id)) {
                    chars.push(next.assets);
                }
                return chars;
            }, [] as any);
        } else if ("locationIds" in scope) {
            const locations = await this.projectRepo.getProjectLocations(scope.projectId);
            assetsHistoryList = locations.reduce((locs, next) => {
                if (scope.locationIds.includes(next.id)) {
                    locs.push(next.assets);
                }
                return locs;
            }, [] as any);
        }
        else {
            const project = await this.projectRepo.getProject(scope.projectId);
            assetsHistoryList = [ project.assets || {} ];
        }

        return assetsHistoryList.map(assetsMap => assetsMap[ assetKey ] || { head: 0, best: 0, versions: {} });
    }

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

    private getEntityIdFromScope(scope: Scope, index: number): string {
        if ("sceneId" in scope) return scope.sceneId;
        if ("characterIds" in scope) return scope.characterIds[ index ] || "unknown";
        if ("locationIds" in scope) return scope.locationIds[ index ] || "unknown";
        return scope.projectId;
    }
}
