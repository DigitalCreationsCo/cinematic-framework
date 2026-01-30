import {
    Scene, Character, Location, Project,
    InsertProject,
    ProjectEntity
} from "../types/index.js";



interface MapDBProjectToDomainProps extends ProjectEntity {
    scenes?: Scene[],
    characters?: Character[],
    locations?: Location[],
}

/**
 * Maps a DB ProjectEntity + hydrated relations to a strict Project domain object.
 * Enforces ProjectSchema validation - throws if project is not fully hydrated.
 */
export function mapDbProjectToDomain({ scenes = [], characters = [], locations = [], ...entity }: MapDBProjectToDomainProps): Project {
    const project = {
        ...entity,
        scenes,
        characters,
        locations,
    };
    return Project.parse(project);
}

export function mapDomainProjectToInsertProjectDb(project: InsertProject): InsertProject {
    return InsertProject.parse(project);
}