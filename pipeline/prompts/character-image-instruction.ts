import { Character } from "../../shared/pipeline-types";
import { buildCostumeAndMakeupPrompt } from "./role-costume-makeup";

export const buildCharacterImagePrompt = (character: Character): string => {
    return buildCostumeAndMakeupPrompt(character);
};
