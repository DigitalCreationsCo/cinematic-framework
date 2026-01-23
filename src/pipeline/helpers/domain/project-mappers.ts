import {
    Scene, Character, Location, Project
} from "../../../shared/types/workflow.types";
import {
    InsertProject,
    ProjectEntity
} from "../../../shared/db/zod-db";

interface MapDBProjectToDomainProps {
    project: ProjectEntity,
    scenes?: Scene[],
    characters?: Character[],
    locations?: Location[],
}

/**
 * Maps a DB ProjectEntity + hydrated relations to a strict Project domain object.
 * Enforces ProjectSchema validation - throws if project is not fully hydrated.
 */
export function mapDbProjectToDomain({ project: entity, scenes = [], characters = [], locations = [] }: MapDBProjectToDomainProps): Project {
    return Project.parse({ ...entity, scenes, characters, locations });
}

export function mapDomainProjectToDb(project: Project) {
    return InsertProject.parse(project);
}