import {
    Scene, Character, Location, Project,
} from "../../../shared/types/pipeline.types";
import {
    ProjectEntity
} from "../../../shared/zod-db";

export function mapDbProjectToDomain(entity: ProjectEntity, scenes: Scene[] = [], chars: Character[] = [], locs: Location[] = []): Project {
    return {
        id: entity.id,
        projectId: entity.id, // For TagSchema compatibility
        createdAt: entity.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: entity.updatedAt?.toISOString() || new Date().toISOString(),
        metadata: entity.metadata,
        metrics: entity.metrics || undefined,
        status: entity.status as any,
        currentSceneIndex: entity.currentSceneIndex,
        forceRegenerateSceneIds: entity.forceRegenerateSceneIds || [],
        generationRules: entity.generationRules || [],
        generationRulesHistory: [], // Not persisted in new schema? Defaulting.
        assets: entity.assets || {},
        // Relations
        storyboard: {
            metadata: entity.metadata,
            scenes: scenes,
            characters: chars,
            locations: locs,
        },
        scenes,
        characters: chars,
        locations: locs
    } as unknown as Project; // Casting because Project type might vary slightly from DB entity
}