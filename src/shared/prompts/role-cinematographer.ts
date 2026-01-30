export const promptVersion = "3.0.0-cinematographer";

import { cameraAnglesWithDescriptions, cameraMovementsWithDescriptions, Composition, Scene, shotTypesWithDescriptions, TransitionTypes } from "../types/index.js";
import { getJSONSchema } from '../../shared/utils/utils.js';

/**
 * CINEMATOGRAPHER - Shot Composition & Framing
 * Specifies shot type, camera angle, camera movement, and composition
 * 
 * (Currently not used in favoer of narraitve approach by buildCinematographerNarrative)
 */

export const buildCinematographerGuidelines = () => `
CINEMATOGRAPHER SPECIFICATIONS:

For each scene, select from these options:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHOT TYPE (choose ONE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(shotTypesWithDescriptions)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMERA ANGLE (choose ONE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(cameraAnglesWithDescriptions)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMERA MOVEMENT (choose ONE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(cameraMovementsWithDescriptions)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPOSITION (specify all):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(getJSONSchema(Composition))}
`;

export const buildCinematographerFrameComposition = (
  scene: Scene,
  framePosition: "start" | "end"
) => `
CINEMATOGRAPHER FRAME SPECIFICATIONS for Scene ${scene.id}:

DIRECTOR'S INTENT: ${scene.description}
MOOD: ${scene.mood}
DURATION: ${scene.duration}s
FRAME POSITION: ${framePosition.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHOT SELECTION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Shot Type: ${scene.shotType || JSON.stringify(shotTypesWithDescriptions)}
Camera Angle: ${JSON.stringify(cameraAnglesWithDescriptions)}
Camera Movement: ${scene.cameraMovement || JSON.stringify(cameraMovementsWithDescriptions)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPOSITION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(getJSONSchema(Composition))}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${framePosition === "start" ? "START FRAME" : "END FRAME"} SPECIFIC:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${framePosition === "start"
    ? `- Subject positioning for action INITIATION
- Clear staging for movement to BEGIN
- Anticipatory pose: weight forward, eyes directed toward action
- Body language showing intent to move/act`
    : `- Subject positioning showing action COMPLETION
- Resolved pose: weight settled, action finished
- Body language showing arrived state
- Clear staging for transition to next scene`
  }

CONSTRAINT: Avoid mid-motion awkwardness. Keyframes show clear before/after states, not transitional moments.

OUTPUT: Structured specifications (not prose descriptions).
`;

export const buildCinematographerNarrative = (
  scene: Scene,
  framePosition?: "start" | "end"
) => {
  const shotMap: Record<string, string> = {
    "ECU": "Extreme Close-Up",
    "CU": "Close-Up",
    "MCU": "Medium Close-Up",
    "MS": "Medium Shot",
    "MW": "Medium Wide Shot",
    "WS": "Wide Shot",
    "VW": "Very Wide Establishing Shot"
  };

  const shotType = shotMap[ scene.shotType || "" ] || scene.shotType || "Cinematic shot";
  const movement = scene.cameraMovement ? `, with ${scene.cameraMovement.toLowerCase()} movement` : "";
  const angle = scene.cameraAngle ? ` from a ${scene.cameraAngle.toLowerCase()} angle` : "";

  let narrative = `A ${shotType.toLowerCase()} captured${angle}${movement}.`;

  if (scene.composition) {
    narrative += ` The composition is characterized by ${JSON.stringify(scene.composition).replace(/[\n\r]+/g, ", ")}.`;
  }

  if (framePosition) {
    narrative += framePosition === "start"
      ? " This frame captures the initial moment of action."
      : " This frame captures the resolution of the action.";
  }

  return narrative;
};

export const buildCinematographerPrompt = (scene: Scene, directorVision: string) => `
As the CINEMATOGRAPHER, specify shot composition for Scene ${scene.id}.

DIRECTOR'S INTENT: ${scene.description}
VISUAL STYLE: ${directorVision}
DURATION: ${scene.duration}s | MOOD: ${scene.mood} | INTENSITY: ${scene.intensity}

${buildCinematographerGuidelines()}

SPECIFY:
- Shot Type: [Choose ONE from menu above]
- Camera Angle: [Choose ONE from menu above]
- Camera Movement: [Choose ONE from menu above] with motivation: [Why this movement serves the story]
- Composition details: [Subject placement, focal point, depth layers, leading lines, headroom, look room]

CONSTRAINT: Selections must serve the emotional intent and narrative action. Avoid arbitrary choices.

OUTPUT: Concise specifications using exact terms from menus provided.
`;
