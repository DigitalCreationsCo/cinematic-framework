import {
    Character,
    SceneAttributes,
    Scene
} from "../types/workflow.types.js";
import {
    CharacterEntity,
    InsertCharacter
} from "../db/zod-db.js";
import { z } from "zod";



export function mapDbCharacterToDomain(entity: CharacterEntity): Character {
    return Character.parse(entity);
}

export function mapDomainCharacterToInsertCharacterDb(char: z.input<typeof InsertCharacter>): z.infer<typeof InsertCharacter> {
    return InsertCharacter.parse(char);
}

/**
 * Extracts scene-to-character join records from scene drafts.
 * Ensures the character reference list is flattened into a format 
 * compatible with the scenesToCharacters join table.
 */
export function extractCharacterJoins(sceneDrafts: Scene[]): { sceneId: string; characterId: string; }[] {
    return sceneDrafts.flatMap((draft) => {
        if (!draft.id || !Array.isArray(draft.characters)) {
            return [];
        }

        return draft.characters.map((charId: string) => ({
            sceneId: draft.id,
            characterId: charId,
        }));
    });
}