import {
    LocationAttributes,
    Location
} from "../../../shared/types/workflow.types";
import {
    InsertLocation,
    LocationEntity
} from "../../../shared/db/zod-db";

export function mapDbLocationToDomain(entity: LocationEntity): Location {
    return Location.parse(entity);
}

export function mapDomainLocationToDb(loc: LocationAttributes) {
    return InsertLocation.parse(loc);
};