import { Location } from "../types/workflow.types.js";
import { composeGenerationRules } from "./prompt-composer.js";
import { buildProductionDesignerPrompt } from "./role-production-designer.js";

/**
 * LOCATION IMAGE GENERATION - Using Role-Based Prompt (Production Designer)
 */

export const buildLocationImagePrompt = (location: Location, generationRules?: string[]): string => {
    // Use the new role-based Production Designer prompt
    return buildProductionDesignerPrompt(location) + composeGenerationRules(generationRules);
};
