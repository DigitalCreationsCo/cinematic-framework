import {
    Character,
    InsertCharacter,
    SceneAttributes,
    Scene,
    DbScenesToCharacters,
} from "../types/index.js";
import { z } from "zod";



export function mapDbCharacterToDomain(entity: Character): Character {
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
export function extractCharacterJoins(sceneDrafts: Scene[]): DbScenesToCharacters[] {
    return sceneDrafts.flatMap((draft) => {
        if (!draft.id || !Array.isArray(draft.characterIds)) {
            return [];
        }

        return draft.characterIds.map((charId: string) => ({
            sceneId: draft.id,
            characterId: charId,
        }));
    });
}