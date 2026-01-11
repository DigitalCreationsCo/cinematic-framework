import { characters } from "../../../shared/schema";
import {
    Character
} from "../../../shared/types/pipeline.types";
import {
    CharacterEntity
} from "../../../shared/zod-db";

export function mapDbCharacterToDomain(entity: CharacterEntity): Character {
    const character: Character = {
        id: entity.id,
        projectId: entity.projectId,
        referenceId: entity.referenceId,
        name: entity.name,
        age: entity.age,
        aliases: entity.aliases,
        physicalTraits: entity.physicalTraits,
        appearanceNotes: entity.appearanceNotes,
        assets: entity.assets,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
    };
    return character;
}

export function mapDomainCharacterToDb(char: Character): typeof characters.$inferInsert {
    return {
        id: char.id,
        name: char.name,
        physicalTraits: char.physicalTraits,
        referenceId: char.referenceId,
        age: char.age,
        projectId: char.projectId,
        assets: char.assets,
        appearanceNotes: char.appearanceNotes,
    };
}