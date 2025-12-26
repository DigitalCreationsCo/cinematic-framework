/**
 * PROMPT COMPOSER - Role-Based Prompt Composition Utilities
 *
 * This module provides helper functions for composing multi-role prompts
 * at various generation points in the workflow.
 */

import { Scene, Character, Location, QualityEvaluationResult, SceneSchema, zodToJSONSchema } from "../../shared/pipeline-types";
import { buildDirectorSceneBeatPrompt } from "./role-director";
import { buildCinematographerGuidelines, buildCinematographerFrameComposition } from "./role-cinematographer";
import { buildGafferGuidelines, buildGafferLightingSpec } from "./role-gaffer";
import { buildScriptSupervisorContinuityChecklist } from "./role-script-supervisor";
import { buildCostumeAndMakeupSpec } from "./role-costume-makeup";
import { buildProductionDesignerSpec } from "./role-production-designer";
import { formatCharacterSpecs, formatLocationSpecs } from "../utils";

/**
 * Format character temporal state for prompts
 */
const formatCharacterTemporalState = (character: Character): string => {
  if (!character.state) return "";

  const state = character.state;
  const parts: string[] = [];

  // Physical condition
  if (state.injuries && state.injuries.length > 0) {
    parts.push(`Injuries: ${state.injuries.map(inj => `${inj.type} on ${inj.location} (${inj.severity})`).join(", ")}`);
  }

  // Dirt/exhaustion/sweat
  if (state.dirtLevel && state.dirtLevel !== "clean") {
    parts.push(`Dirt Level: ${state.dirtLevel.replace("_", " ")}`);
  }
  if (state.exhaustionLevel && state.exhaustionLevel !== "fresh") {
    parts.push(`Exhaustion: ${state.exhaustionLevel.replace("_", " ")}`);
  }
  if (state.sweatLevel && state.sweatLevel !== "dry") {
    parts.push(`Sweat: ${state.sweatLevel}`);
  }

  // Costume condition
  if (state.costumeCondition) {
    const { tears, stains, wetness, damage } = state.costumeCondition;
    if (tears && tears.length > 0) {
      parts.push(`Costume Tears: ${tears.join(", ")}`);
    }
    if (stains && stains.length > 0) {
      parts.push(`Costume Stains: ${stains.join(", ")}`);
    }
    if (wetness && wetness !== "dry") {
      parts.push(`Costume Wetness: ${wetness}`);
    }
    if (damage && damage.length > 0) {
      parts.push(`Costume Damage: ${damage.join(", ")}`);
    }
  }

  // Hair condition
  if (state.hairCondition) {
    const { messiness, wetness } = state.hairCondition;
    if (messiness && messiness !== "pristine") {
      parts.push(`Hair: ${messiness.replace("_", " ")}`);
    }
    if (wetness && wetness !== "dry") {
      parts.push(`Hair Wetness: ${wetness}`);
    }
  }

  return parts.length > 0
    ? `\nCURRENT STATE (MUST MAINTAIN):\n${parts.map(p => `  - ${p}`).join("\n")}`
    : "";
};

/**
 * Format location temporal state for prompts
 */
const formatLocationTemporalState = (location: Location): string => {
  if (!location.state) return "";

  const state = location.state;
  const parts: string[] = [];

  // Time and weather
  if (state.timeOfDay) {
    parts.push(`Time of Day: ${state.timeOfDay}`);
  }
  if (state.weather) {
    parts.push(`Weather: ${state.weather}`);
  }
  if (state.precipitation && state.precipitation !== "none") {
    parts.push(`Precipitation: ${state.precipitation}`);
  }
  if (state.visibility && state.visibility !== "clear") {
    parts.push(`Visibility: ${state.visibility.replace("_", " ")}`);
  }

  // Ground condition
  if (state.groundCondition) {
    const { wetness, debris, damage } = state.groundCondition;
    if (wetness && wetness !== "dry") {
      parts.push(`Ground: ${wetness}`);
    }
    if (debris && debris.length > 0) {
      parts.push(`Debris: ${debris.join(", ")}`);
    }
    if (damage && damage.length > 0) {
      parts.push(`Environmental Damage: ${damage.join(", ")}`);
    }
  }

  // Broken objects
  if (state.brokenObjects && state.brokenObjects.length > 0) {
    parts.push(`Broken Objects: ${state.brokenObjects.map(obj => obj.description).join(", ")}`);
  }

  // Atmospheric effects
  if (state.atmosphericEffects && state.atmosphericEffects.length > 0) {
    const active = state.atmosphericEffects.filter(e => !e.dissipating);
    if (active.length > 0) {
      parts.push(`Atmospheric Effects: ${active.map(e => `${e.type} (${e.intensity})`).join(", ")}`);
    }
  }

  return parts.length > 0
    ? `\nCURRENT STATE (MUST MAINTAIN):\n${parts.map(p => `  - ${p}`).join("\n")}`
    : "";
};

/**
 * Compose storyboard enrichment prompt (Director + Cinematographer + Gaffer)
 * Used in Generation Point 1.4
 */
export const composeStoryboardEnrichmentPrompt = (
  creativePrompt: string,
  characters: Character[],
  locations: Location[],
  schema: object,
  audioContext?: string
) => `
You are enriching the storyboard for a cinematic music video.

CREATIVE PROMPT:
${creativePrompt}

${audioContext ? `MUSICAL CONTEXT:\n${audioContext}` : ""}

ESTABLISHED CHARACTERS:
${formatCharacterSpecs(characters)}

ESTABLISHED LOCATIONS:
${formatLocationSpecs(locations)}

For each scene, provide specifications from three departments:

═══════════════════════════════════════════════════════════
DIRECTOR - Narrative Intent
═══════════════════════════════════════════════════════════
${buildDirectorSceneBeatPrompt()}

═══════════════════════════════════════════════════════════
CINEMATOGRAPHER - Shot Composition
═══════════════════════════════════════════════════════════
${buildCinematographerGuidelines()}

═══════════════════════════════════════════════════════════
GAFFER - Lighting Design
═══════════════════════════════════════════════════════════
${buildGafferGuidelines()}

OUTPUT FORMAT: 
Produce JSON matching this exact structure:
${JSON.stringify(schema, null, 2)}
`;

/**
 * Compose frame generation prompt (Cinematographer + Gaffer + Script Supervisor)
 * Used in Generation Points 3.1 and 3.2
 */
export const composeFrameGenerationPrompt = (
  scene: Scene,
  framePosition: "start" | "end",
  characters: Character[],
  locations: Location[],
  previousScene?: Scene,
  generationRules?: string[]
) => {
  const location = locations.find((l) => l.id === scene.locationId);

  return `
GENERATE ${framePosition.toUpperCase()} KEYFRAME for Scene ${scene.id}

═══════════════════════════════════════════════════════════
CINEMATOGRAPHER - Frame Composition
═══════════════════════════════════════════════════════════
${buildCinematographerFrameComposition(scene, framePosition)}

═══════════════════════════════════════════════════════════
GAFFER - Lighting Specification
═══════════════════════════════════════════════════════════
${buildGafferLightingSpec(scene, location, location?.timeOfDay)}

═══════════════════════════════════════════════════════════
SCRIPT SUPERVISOR - Continuity Requirements
═══════════════════════════════════════════════════════════
${buildScriptSupervisorContinuityChecklist(scene, previousScene, characters, locations)}

═══════════════════════════════════════════════════════════
COSTUME & MAKEUP - Character Appearance
═══════════════════════════════════════════════════════════
${characters.map((c) => `${buildCostumeAndMakeupSpec(c)}${formatCharacterTemporalState(c)}`).join("\n\n")}

═══════════════════════════════════════════════════════════
PRODUCTION DESIGN - Location Environment
═══════════════════════════════════════════════════════════
${location ? `${buildProductionDesignerSpec(location)}${formatLocationTemporalState(location)}` : "No location specified"}

${generationRules && generationRules.length > 0
      ? `
═══════════════════════════════════════════════════════════
GLOBAL GENERATION RULES (from previous quality evaluations):
═══════════════════════════════════════════════════════════
${generationRules.map((rule) => `- ${rule}`).join("\n")}
`
      : ""
    }

═══════════════════════════════════════════════════════════
REFERENCE IMAGES ATTACHED:
═══════════════════════════════════════════════════════════
${previousScene && framePosition === "start" ? `- Previous scene end frame (for transition continuity)` : ""}
${characters.map((c) => `- ${c.name} reference: ${c.referenceImages?.[ 0 ] || "Not available"}`).join("\n")}
${location ? `- ${location.name} reference: ${location.referenceImages?.[ 0 ] || "Not available"}` : ""}

CRITICAL INSTRUCTIONS:
- Match character appearances to reference images EXACTLY
- Match location environment to reference image EXACTLY
- Follow Script Supervisor continuity checklist precisely
- Compose frame according to Cinematographer specifications
- Light scene according to Gaffer specifications
- Frame must show clear ${framePosition === "start" ? "BEGINNING" : "ENDING"} state (not mid-action)

OUTPUT: Generate photorealistic ${framePosition} keyframe image. No text in image.
`;
};

/**
 * Compose enhanced scene prompt for video generation
 * Used in Generation Point 3.3
 */
export const composeEnhancedSceneGenerationPrompt = (
  scene: Scene,
  characters: Character[],
  location: Location,
  previousScene?: Scene,
  generationRules?: string[]
): string => {
  const characterSpecs = characters
    .map(
      (c) => `
${c.name}:
- Physical: ${c.description}
- Hair: ${c.physicalTraits.hair}
- Clothing: ${c.physicalTraits.clothing}
- Accessories: ${c.physicalTraits.accessories?.join(", ") || "None"}
- Reference Image: Match appearance to ${c.referenceImages?.[ 0 ]?.publicUri || "N/A"} EXACTLY${formatCharacterTemporalState(c)}
`
    )
    .join("\n");

  const continuityNotes = previousScene
    ? `
CONTINUITY FROM PREVIOUS SCENE ${previousScene.id}:
- Previous action: ${previousScene.description}
- Previous lighting: ${previousScene.lighting}
- Previous mood: ${previousScene.mood}
- Character positions: Maintain spatial logic (if exited left, enters right)
- Character states: Carry forward any dirt, damage, exhaustion
- End frame reference: ${previousScene.endFrame?.publicUri || "N/A"}
`
    : "This is the FIRST scene - establish all baselines.";

  return `
SCENE ${scene.id}: ${scene.startTime}s - ${scene.endTime}s (${scene.duration}s)

═══════════════════════════════════════════════════════════
NARRATIVE (Director):
═══════════════════════════════════════════════════════════
${scene.description}

Mood: ${scene.mood}
Intensity: ${scene.intensity}
Tempo: ${scene.tempo}
Musical Context: ${scene.musicalDescription || "N/A"}

═══════════════════════════════════════════════════════════
CHARACTERS (Costume & Makeup):
═══════════════════════════════════════════════════════════
${characterSpecs}

═══════════════════════════════════════════════════════════
LOCATION (Production Design):
═══════════════════════════════════════════════════════════
${location.name}:
- Type: ${location.type || "Unspecified"}
- Description: ${location.description}
- Time of Day: ${location.state?.timeOfDay || location.timeOfDay}
- Weather: ${location.state?.weather || location.weather || "Clear"}
- Key Elements: ${[ ...(location.naturalElements || []), ...(location.manMadeObjects || []) ].join(", ")}
- Reference Image: Match environment to ${location.referenceImages?.[ 0 ] || "N/A"} EXACTLY${formatLocationTemporalState(location)}

═══════════════════════════════════════════════════════════
CINEMATOGRAPHY:
═══════════════════════════════════════════════════════════
Shot Type: ${scene.shotType}
Camera Movement: ${scene.cameraMovement}
Camera Angle: ${scene.cameraAngle}
Composition: ${scene.composition || "Standard framing for shot type"}

═══════════════════════════════════════════════════════════
LIGHTING (Gaffer):
═══════════════════════════════════════════════════════════
${scene.lighting}

═══════════════════════════════════════════════════════════
CONTINUITY (Script Supervisor):
═══════════════════════════════════════════════════════════
${continuityNotes}

${scene.continuityNotes && scene.continuityNotes.length > 0
      ? `
SPECIFIC CONTINUITY REQUIREMENTS:
${scene.continuityNotes.map((note) => `- ${note}`).join("\n")}
`
      : ""
    }

${generationRules && generationRules.length > 0
      ? `
═══════════════════════════════════════════════════════════
GLOBAL GENERATION RULES:
═══════════════════════════════════════════════════════════
${generationRules.map((rule) => `- ${rule}`).join("\n")}
`
      : ""
    }

═══════════════════════════════════════════════════════════
KEYFRAMES PROVIDED:
═══════════════════════════════════════════════════════════
- Start Frame: ${scene.startFrame?.publicUri || "Not yet generated"}
- End Frame: ${scene.endFrame?.publicUri || "Not yet generated"}

CRITICAL INSTRUCTIONS:
- Generate video matching ALL specifications above
- Character appearances MUST match reference images EXACTLY throughout video
- Location environment MUST match reference image EXACTLY
- Video must transition smoothly from start frame to end frame
- Maintain continuity with previous scene
- Follow lighting and camera specifications precisely
- Duration MUST be exactly ${scene.duration} seconds
`;
};

/**
 * Compose department specifications for quality evaluation
 * Used in Generation Point 4.1
 */
export interface DepartmentSpecsForEvaluation {
  director: string;
  cinematographer: string;
  gaffer: string;
  scriptSupervisor: string;
  costume: string;
  productionDesign: string;
}

export const composeDepartmentSpecs = (
  scene: Scene,
  characters: Character[],
  location: Location,
  previousScene?: Scene
): DepartmentSpecsForEvaluation => {
  return {
    director: `Scene ${scene.id}: ${scene.description}
Mood: ${scene.mood} | Intensity: ${scene.intensity} | Tempo: ${scene.tempo}`,

    cinematographer: `Shot Type: ${scene.shotType}
Camera Movement: ${scene.cameraMovement}
Composition: ${scene.composition || "Standard for shot type"}`,

    gaffer: `Lighting: ${scene.lighting}
Time of Day: ${location.timeOfDay}
Weather: ${location.weather || "Clear"}`,

    scriptSupervisor: previousScene
      ? `Continuity from Scene ${previousScene.id}:
- Previous action: ${previousScene.description}
- Previous lighting: ${previousScene.lighting}
- Continuity notes: ${scene.continuityNotes?.join("; ") || "Standard continuity"}`
      : "First scene - baseline established",

    costume: characters
      .map(
        (c) => `${c.name}:
Hair: ${c.physicalTraits.hair}
Clothing: ${typeof c.physicalTraits.clothing === "string" ? c.physicalTraits.clothing : c.physicalTraits.clothing?.join(", ")}
Accessories: ${c.physicalTraits.accessories?.join(", ") || "None"}
Reference: ${c.referenceImages?.[ 0 ] || "N/A"}`
      )
      .join("\n\n"),

    productionDesign: `${location.name}:
Type: ${location.type || "Unspecified"}
Time of Day: ${location.timeOfDay}
Key Elements: ${[ ...(location.naturalElements || []), ...(location.manMadeObjects || []) ].join(", ")}
Reference: ${location.referenceImages?.[ 0 ] || "N/A"}`,
  };
};

/**
 * Helper to extract and format generation rules from evaluation
 */
export const extractGenerationRules = (evaluations: QualityEvaluationResult[]): string[] => {
  const rules: string[] = [];

  for (const evaluation of evaluations) {
    if (evaluation.ruleSuggestion && typeof evaluation.ruleSuggestion === "string") {
      rules.push(evaluation.ruleSuggestion);
    }
  }

  return [ ...new Set(rules) ];
};
