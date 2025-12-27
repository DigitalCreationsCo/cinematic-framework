export const promptVersion = "3.0.0-gaffer";

import { Scene, Location } from "../../shared/pipeline-types";

/**
 * GAFFER - Lighting Design
 * Specifies lighting quality, motivated sources, color temperature, and atmospheric effects
 */

export const buildGafferGuidelines = () => `
GAFFER LIGHTING SPECIFICATIONS:

For each scene, specify:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIGHT QUALITY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hardness: [Soft (diffused, gentle shadows) / Hard (sharp, defined shadows)]
Color Temperature: [Warm 2700-3500K / Neutral 4000-5000K / Cool 5500-7000K]
Intensity: [Low (dim, moody) / Medium (balanced) / High (bright, energetic)]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOTIVATED SOURCES (where does light come from?):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Primary Light: [Sun through window / street lamp / overhead ceiling / firelight / etc.]
Fill Light: [Ambient skylight / reflected surfaces / secondary practicals]
Accent Light: [Rim light from behind / side window / bounce from ground]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIGHTING DIRECTION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Key Light Position: [Front-left/right 45° / Side 90° / Back 135-180° / Top-down]
Shadow Direction: [Falling left/right/forward/behind subject]
Contrast Ratio: [Low (1:2) flat / Medium (1:4) standard / High (1:8+) dramatic]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ATMOSPHERE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Haze/Fog: [None / Light mist / Dense fog]
Light Beams: [Visible shafts/rays / None]
Practical Lights: [List visible light sources in frame: lamps, candles, screens]

CONSTRAINT: All lighting must be MOTIVATED (justified by visible source or environment).
`;

export const buildGafferLightingSpec = (
  scene: Scene,
  location?: Location,
  timeOfDay?: string
) => `
GAFFER LIGHTING SPECIFICATIONS for Scene ${scene.id}:

LOCATION: ${location?.name || "Unspecified"}
TIME OF DAY: ${timeOfDay || location?.timeOfDay || "Unspecified"}
WEATHER: ${location?.weather || "Clear"}
SCENE MOOD: ${scene.mood}
SCENE LIGHTING: ${scene.lighting}
INTENSITY: ${scene.intensity}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPECIFY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LIGHT QUALITY:
- Hardness: [Soft / Hard]
- Color Temperature: [Warm 2700-3500K / Neutral 4000-5000K / Cool 5500-7000K]
- Intensity: [Low / Medium / High]

MOTIVATED SOURCES:
- Primary Light: [Describe natural/practical source]
- Fill Light: [Describe ambient/reflected source]
- Accent Light: [Describe rim/edge source if present]

LIGHTING DIRECTION:
- Key Light Position: [Describe angle and direction]
- Shadow Direction: [Where shadows fall relative to subject]
- Contrast Ratio: [Low 1:2 / Medium 1:4 / High 1:8+]

ATMOSPHERE:
- Haze/Fog: [None / Light / Dense]
- Light Beams: [Visible / None]
- Practical Lights: [List any visible light sources in frame]

${scene.id > 1
    ? `
CONTINUITY FROM PREVIOUS SCENE:
- Previous lighting must match UNLESS location/time changed
- If same location: lighting direction MUST be consistent
- If time passed: adjust intensity/color temperature appropriately
`
    : ""
  }

CONSTRAINT: Every light must have a motivated source. No unmotivated lighting.

OUTPUT: Concise lighting specification using model-friendly language (not technical jargon).
`;

export const buildGafferPrompt = (scene: Scene, location: Location, timeOfDay: string) => `
As the GAFFER, design lighting for Scene ${scene.id}.

LOCATION: ${location.name} | TIME: ${timeOfDay} | WEATHER: ${location.weather}
MOOD: ${scene.mood} | INTENSITY: ${scene.intensity}

${buildGafferGuidelines()}

SPECIFY all lighting parameters using the guidelines above.

CONSTRAINT: All lighting must be motivated (justified by visible or implied natural source).

OUTPUT: Structured lighting specifications (not technical jargon).
`;
