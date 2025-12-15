import { Location } from "../../shared/pipeline-types";
import { buildProductionDesignerPrompt } from "./role-production-designer";

/**
 * LOCATION IMAGE GENERATION - Using Role-Based Prompt (Production Designer)
 */

export const buildLocationImagePrompt = (location: Location): string => {
    // Use the new role-based Production Designer prompt
    return buildProductionDesignerPrompt(location);
};
