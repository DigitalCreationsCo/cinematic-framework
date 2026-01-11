import {
    Scene, Character, Location, Project, ProjectSchema, createDefaultMetrics,
} from "../../../shared/types/pipeline.types";
import {
    ProjectEntity
} from "../../../shared/zod-db";

/**
 * Maps a DB ProjectEntity + hydrated relations to a strict Project domain object.
 * Enforces ProjectSchema validation - throws if project is not fully hydrated.
 * Should only be called after storyboard generation completes.
 */
export function mapDbProjectToDomain(entity: ProjectEntity, scenes: Scene[] = [], chars: Character[] = [], locs: Location[] = []): Project {
    const rawProject = {
        id: entity.id,
        projectId: entity.id, // For TagSchema compatibility
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        metadata: entity.metadata,
        metrics: entity.metrics ?? createDefaultMetrics(),
        status: entity.status,
        currentSceneIndex: entity.currentSceneIndex,
        forceRegenerateSceneIds: entity.forceRegenerateSceneIds ?? [],
        generationRules: entity.generationRules ?? [],
        generationRulesHistory: entity.generationRulesHistory ?? [],
        assets: entity.assets ?? {},
        // Relations - hydrated from separate DB tables
        storyboard: {
            metadata: entity.metadata,
            scenes: scenes,
            characters: chars,
            locations: locs,
        },
        scenes,
        characters: chars,
        locations: locs
    };

    // Validate and return strict Project type
    return ProjectSchema.parse(rawProject);
}