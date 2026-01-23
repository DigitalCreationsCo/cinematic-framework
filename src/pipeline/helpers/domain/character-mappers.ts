import {
    CharacterAttributes,
    Character
} from "../../../shared/types/workflow.types";
import {
    CharacterEntity,
    InsertCharacter
} from "../../../shared/db/zod-db";

export function mapDbCharacterToDomain(entity: CharacterEntity) {
    return Character.parse(entity);
}

export function mapDomainCharacterToDb(char: CharacterAttributes) {
    return InsertCharacter.parse(char);
}