import {
    Scene, Character, Location, Project, ProjectSchema, createDefaultMetrics,
    InitialProjectSchema,
    InitialProject,
} from "../../../shared/types/pipeline.types";
import {
    ProjectEntity
} from "../../../shared/zod-db";

interface MapDBProjectToDomainProps {
    project: ProjectEntity,
    scenes?: Scene[],
    characters?: Character[],
    locations?: Location[],
    validate?: Boolean;
}

/**
 * Maps a DB ProjectEntity + hydrated relations to a strict Project domain object.
 * Enforces ProjectSchema validation - throws if project is not fully hydrated.
 * Should only be called after storyboard generation completes.
 */
export function mapDbProjectToDomain({
    project,
    scenes,
    characters,
    locations,
    validate,
}: MapDBProjectToDomainProps & { validate?: true; }
): Project;
export function mapDbProjectToDomain({
    project,
    scenes,
    characters,
    locations,
    validate,
}: MapDBProjectToDomainProps & { validate?: false; }
): InitialProject;
export function mapDbProjectToDomain(
    { project: entity, scenes = [], characters = [], locations = [], validate = true }: MapDBProjectToDomainProps): Project | InitialProject {
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
        audioAnalysis: entity.audioAnalysis,
        // Relations - hydrated from separate DB tables
        storyboard: {
            metadata: entity.metadata,
            scenes: scenes,
            characters: characters,
            locations: locations,
        },
        scenes,
        characters: characters,
        locations: locations
    };

    if (validate) {
        return ProjectSchema.parse(rawProject) as Project;
    }
    return rawProject;
}