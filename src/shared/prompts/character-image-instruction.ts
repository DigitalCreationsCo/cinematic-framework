import { Character } from "../types/workflow.types.js";
import { composeGenerationRules } from "./prompt-composer.js";
import { buildCostumeAndMakeupPrompt } from "./role-costume-makeup.js";

export const buildCharacterImagePrompt = (character: Character, generationRules?: string[]): string => {
    return buildCostumeAndMakeupPrompt(character) + composeGenerationRules(generationRules);
};
