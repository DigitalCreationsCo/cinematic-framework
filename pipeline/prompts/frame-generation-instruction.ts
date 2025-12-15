import { Scene, Character, Location } from "../../shared/pipeline-types";
import { composeFrameGenerationPrompt } from "./prompt-composer";

/**
 * FRAME GENERATION - Using Role-Based Prompt Composition
 * Combines Cinematographer + Gaffer + Script Supervisor + Costume + Production Design
 */

export const buildFrameGenerationPrompt = (
    framePosition: "start" | "end",
    scene: Scene,
    characters: Character[],
    locations: Location[],
    previousScene?: Scene,
    generationRules?: string[],
): string => {
    return composeFrameGenerationPrompt(
        scene,
        framePosition,
        characters,
        locations,
        previousScene,
        generationRules
    );
};
