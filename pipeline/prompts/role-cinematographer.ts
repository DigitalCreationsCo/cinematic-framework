export const promptVersion = "3.0.0-cinematographer";

import { Scene } from "../../shared/pipeline-types";

/**
 * CINEMATOGRAPHER - Shot Composition & Framing
 * Specifies shot type, camera angle, camera movement, and composition
 */

export const buildCinematographerGuidelines = () => `
CINEMATOGRAPHER SPECIFICATIONS:

For each scene, select from these options:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHOT TYPE (choose ONE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ECU (Extreme Close-Up): Eyes, hands, small object details
- CU (Close-Up): Head and shoulders only
- MCU (Medium Close-Up): Chest up
- MS (Medium Shot): Waist up
- MW (Medium Wide): Knees up
- WS (Wide Shot): Full body head-to-toe visible
- VW (Very Wide/Establishing): Environment dominates, characters small in frame

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMERA ANGLE (choose ONE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Eye Level: Neutral, relatable perspective
- High Angle: 15-45° looking down (subject appears smaller/vulnerable)
- Low Angle: 15-45° looking up (subject appears larger/powerful)
- Bird's Eye: 90° directly overhead
- Dutch Angle: Tilted horizon (creates psychological unease)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMERA MOVEMENT (choose ONE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Static: No movement [use for: stable moments, observation]
- Pan Left/Right: Horizontal rotation [use for: following action, revealing space]
- Tilt Up/Down: Vertical rotation [use for: revealing scale, subject to context]
- Dolly In: Moving toward subject [use for: intensifying focus, building tension]
- Dolly Out: Moving away [use for: revealing context, showing isolation]
- Track/Follow: Moving alongside [use for: dynamic action, following character]
- Handheld: Unstable, organic [use for: intimacy, chaos, urgency]
- Crane/Aerial: Sweeping vertical [use for: grand reveals, transitions]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPOSITION (specify all):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Subject Placement: [Left third / Center / Right third]
- Focal Point: [What draws the eye first]
- Depth Layers: [Foreground: X, Midground: Y, Background: Z]
- Leading Lines: [Any lines guiding viewer's eye toward subject]
- Headroom: [Tight/Standard/Generous - space above subject's head]
- Look Room: [Space in direction subject faces or moves]
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
Shot Type: ${scene.shotType || "[Select from: ECU, CU, MCU, MS, MW, WS, VW]"}
Camera Angle: [Select from: Eye Level, High Angle, Low Angle, Bird's Eye, Dutch]
Camera Movement: ${scene.cameraMovement || "[Select from: Static, Pan, Tilt, Dolly In/Out, Track, Handheld, Crane]"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPOSITION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Subject Placement: [Left third / Center / Right third]
Focal Point: [Primary element that draws viewer's eye]
Depth Layers:
  - Foreground: [What's closest to camera]
  - Midground: [Where main action occurs]
  - Background: [Environmental context]
Leading Lines: [Describe any lines guiding eye to subject]
Headroom: [Tight / Standard / Generous]
Look Room: [Space in direction of subject's gaze or motion]

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
    narrative += ` The composition is characterized by ${scene.composition.replace(/[\n\r]+/g, ", ")}.`;
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
