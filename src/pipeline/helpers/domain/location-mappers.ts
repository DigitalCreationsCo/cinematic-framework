import { locations } from "../../../shared/schema";
import {
    Location
} from "../../../shared/types/pipeline.types";
import {
    LocationEntity
} from "../../../shared/zod-db";

export function mapDbLocationToDomain(entity: LocationEntity): Location {
    const location: Location = {
        id: entity.id,
        projectId: entity.projectId,
        referenceId: entity.projectId,
        name: entity.name,
        mood: entity.mood,
        lightingConditions: entity.lightingConditions,
        timeOfDay: entity.timeOfDay,
        weather: entity.weather,
        colorPalette: entity.colorPalette,
        architecture: entity.architecture,
        naturalElements: entity.naturalElements,
        manMadeObjects: entity.manMadeObjects,
        groundSurface: entity.groundSurface,
        skyOrCeiling: entity.skyOrCeiling,
        assets: entity.assets,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
    };
    return location;
}

export function mapDomainLocationToDb(loc: Location): typeof locations.$inferInsert {
    return {
        id: loc.id,
        projectId: loc.projectId,
        name: loc.name,
        mood: loc.mood,
        colorPalette: loc.colorPalette,
        referenceId: loc.referenceId,
        timeOfDay: loc.timeOfDay,
        weather: loc.weather,
        lightingConditions: loc.lightingConditions,
        architecture: loc.architecture,
        naturalElements: loc.naturalElements,
        manMadeObjects: loc.manMadeObjects,
        groundSurface: loc.groundSurface,
        skyOrCeiling: loc.skyOrCeiling,
    };
};