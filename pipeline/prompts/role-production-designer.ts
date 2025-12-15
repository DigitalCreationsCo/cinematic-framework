export const promptVersion = "3.0.0-production-designer";

import { Location } from "../../shared/pipeline-types";

/**
 * PRODUCTION DESIGNER - Location & Environment Specification
 * Generates reference images and specifies exact environmental details for continuity
 */

export const buildProductionDesignerPrompt = (location: Location): string => {
  return `PRODUCTION DESIGN SPECIFICATION: ${location.name}

Generate photorealistic reference image with EXACT specifications below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOCATION DESCRIPTION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${location.description}

TYPE: ${location.type || "Unspecified"}
TIME OF DAY: ${location.timeOfDay}
WEATHER: ${location.weather || "Clear"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENVIRONMENTAL ELEMENTS (visible in frame):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${location.architecture
      ? `Architecture: ${location.architecture}`
      : "Architecture: Not specified"
    }
${location.naturalElements && location.naturalElements.length > 0
      ? `Natural Elements: ${location.naturalElements.join(", ")}`
      : "Natural Elements: None specified"
    }
${location.manMadeObjects && location.manMadeObjects.length > 0
      ? `Man-Made Objects: ${location.manMadeObjects.join(", ")}`
      : "Man-Made Objects: None specified"
    }
${location.groundSurface
      ? `Ground Surface: ${location.groundSurface}`
      : "Ground Surface: Not specified"
    }
${location.skyOrCeiling
      ? `Sky/Ceiling: ${location.skyOrCeiling}`
      : "Sky/Ceiling: Not specified"
    }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ATMOSPHERIC CONDITIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Lighting Quality: ${location.lightingConditions}
Visibility: [Clear / Hazy / Foggy / etc.]
Color Palette: ${location.colorPalette?.join(", ") || "Not specified"}
Mood: ${location.mood || "Neutral"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPATIAL LAYOUT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Scale: [Intimate/small, medium, large/expansive]
Depth: Foreground, midground, background elements clearly defined
Pathways: How characters can move through this space

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE OUTPUT SPECIFICATIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Framing: Wide establishing shot showing full environment
Camera: Eye-level, slight wide angle for context
Lighting: Natural lighting matching time of day and weather
Focus: Deep depth of field (everything in focus)
Mood: ${location.mood || "Neutral"} (convey through composition and light)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PURPOSE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This image is the CONTINUITY REFERENCE. Every scene in this location must match this appearance EXACTLY.
- Architectural features MUST remain consistent
- Natural elements (trees, rocks, terrain) MUST stay in same positions
- Color palette MUST match
- Lighting quality MUST be consistent (unless time of day changes)

OUTPUT: Generate photorealistic reference image per specifications. No text, no people in image.
`;
};

export const buildProductionDesignerSpec = (location: Location): string => {
  return `
LOCATION SPEC: ${location.name}

Type: ${location.type || "Unspecified"}
Time of Day: ${location.timeOfDay}
Weather: ${location.weather || "Clear"}
Lighting: ${location.lightingConditions}
Key Elements: ${[
      ...(location.naturalElements || []),
      ...(location.manMadeObjects || []),
    ].join(", ")}
Color Palette: ${location.colorPalette?.join(", ") || "Not specified"}

REFERENCE IMAGE: ${location.referenceImages?.[ 0 ] || "Not yet generated"}

CONSTRAINT: Environment MUST match reference image EXACTLY in all scenes at this location.
`;
};
