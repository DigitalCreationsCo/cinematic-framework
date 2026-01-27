import {
    LocationAttributes,
    Location
} from "../types/workflow.types.js";
import {
    InsertLocation,
    LocationEntity
} from "../db/zod-db.js";
import { z } from "zod";



export function mapDbLocationToDomain(entity: LocationEntity): Location {
    return Location.parse(entity);
}

export function mapDomainLocationToInsertLocationDb(loc: z.input<typeof InsertLocation>): z.infer<typeof InsertLocation> {
    return InsertLocation.parse(loc);
};

interface Source {
    referenceId: string;
    id: string;
}

/**
 * Maps reference IDs to character IDs using an optimized Map lookup.
 * @param source - Array of source objects containing the ID mappings.
 * @param targetRefs - Array of reference IDs to be converted.
 * @returns Array of mapped characterIds.
 */
export function mapReferenceIdsToIds<T extends string>(
    source: Source[],
    targetRefs: T[]
): T[] {
    // 1. Pre-allocate the Map size if possible to reduce re-hashing
    const lookupMap = new Map<string, T>();

    // 2. Single-pass index creation
    const sourceLength = source.length;
    for (let i = 0; i < sourceLength; i++) {
        const record = source[ i ];
        lookupMap.set(record.referenceId, record.id as T);
    }

    // 3. Map the targets using constant time O(1) lookups
    const result: T[] = [];
    const targetLength = targetRefs.length;

    for (let j = 0; j < targetLength; j++) {
        const match = lookupMap.get(targetRefs[ j ]);
        if (match !== undefined) {
            result.push(match);
        }
    }

    return result;
}