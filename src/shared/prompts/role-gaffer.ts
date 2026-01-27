export const promptVersion = "3.0.0-gaffer";

import { Scene, Location, Lighting } from "../types/workflow.types.js";
import { getJSONSchema } from '../../shared/utils/utils.js';

export const buildGafferPrompt = (scene: Scene, location: Location, timeOfDay: string) => `
As the GAFFER, design lighting for Scene ${scene.id}.

LOCATION: ${location.name} | TIME: ${timeOfDay} | WEATHER: ${location.weather}
MOOD: ${scene.mood} | INTENSITY: ${scene.intensity}

${buildGafferGuidelines()}

SPECIFY all lighting parameters using the guidelines above.

CONSTRAINT: All lighting must be motivated (justified by visible or implied natural source).

OUTPUT: Structured lighting specifications (not technical jargon).
`;

/**
 * GAFFER - Lighting Design
 * Specifies lighting quality, motivated sources, color temperature, and atmospheric effects
 */
export const buildGafferGuidelines = () => `
GAFFER LIGHTING SPECIFICATIONS:

For each scene, specify:

LIGHT QUALITY:
${JSON.stringify(getJSONSchema(Lighting.shape.quality))}

MOTIVATED SOURCES (where does light come from?):
${JSON.stringify(getJSONSchema(Lighting.shape.motivatedSources))}

LIGHTING DIRECTION:
${JSON.stringify(getJSONSchema(Lighting.shape.direction))}

ATMOSPHERE:
${JSON.stringify(getJSONSchema(Lighting.shape.atmosphere))}

CONSTRAINT: All lighting must be MOTIVATED (justified by visible source or environment).
`;

export const buildGafferLightingSpec = (
  scene: Scene,
  location?: Location,
  timeOfDay?: string
) => `
LOCATION: ${location?.name || "Unspecified"}
TIME OF DAY: ${timeOfDay || location?.timeOfDay || "Unspecified"}
WEATHER: ${location?.weather || "Clear"}
SCENE MOOD: ${scene.mood}
SCENE LIGHTING: ${JSON.stringify(scene.lighting)}
INTENSITY: ${scene.intensity}

${buildGafferGuidelines()}

${scene.sceneIndex > 1
    ? `
CONTINUITY FROM PREVIOUS SCENE:
- Previous lighting must match UNLESS location/time changed
- If same location: lighting direction MUST be consistent
- If time passed: adjust intensity/color temperature appropriately
`
    : ""
  }
`;

