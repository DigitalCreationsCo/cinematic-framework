/**
 * PROMPT COMPOSER - Role-Based Prompt Composition Utilities
 *
 * This module provides helper functions for composing multi-role prompts
 * at various generation points in the workflow.
 */

import { Scene, Character, Location, QualityEvaluationResult } from "../../shared/pipeline-types";
import { buildDirectorSceneBeatPrompt } from "./role-director";
import { buildCinematographerGuidelines, buildCinematographerFrameComposition, buildCinematographerNarrative } from "./role-cinematographer";
import { buildGafferGuidelines, buildGafferLightingSpec } from "./role-gaffer";
import { buildScriptSupervisorContinuityChecklist } from "./role-script-supervisor";
import { buildCostumeAndMakeupSpec, buildCostumeAndMakeupNarrative } from "./role-costume-makeup";
import { buildProductionDesignerSpec, buildProductionDesignerNarrative } from "./role-production-designer";
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
  schema: string,
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
${schema}
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

  // Build the narrative components
  const cinematography = buildCinematographerNarrative(scene, framePosition);
  const locationNarrative = location ? buildProductionDesignerNarrative(location) : "The scene is set in an unspecified location.";
  const characterNarratives = characters.length > 0
    ? characters.map((c) => buildCostumeAndMakeupNarrative(c)).join("\n\n")
    : "No specific characters in this shot.";

  const rules = generationRules && generationRules.length > 0
    ? `\nGENERATION RULES:\n${generationRules.map((rule) => `- ${rule}`).join("\n")}`
    : "";

  return `
IMAGE GENERATION PROMPT:

${cinematography}

ACTION & MOOD:
${scene.description}
Mood: ${scene.mood}

CHARACTERS:
${characterNarratives}
${characters.map(c => formatCharacterTemporalState(c)).join("\n")}

ENVIRONMENT:
${locationNarrative}
${location ? formatLocationTemporalState(location) : ""}

LIGHTING:
${buildGafferLightingSpec(scene, location, location?.timeOfDay)}

CONTINUITY:
${buildScriptSupervisorContinuityChecklist(scene, previousScene, characters, locations)}
${rules}

REFERENCE IMAGES:
${previousScene && framePosition === "start" ? `- Previous scene end frame` : ""}
${characters.map((c) => `- ${c.name} Reference Image`).join("\n")}
${location ? `- ${location.name} Reference Image` : ""}

INSTRUCTIONS:
- Generate a photorealistic ${framePosition} keyframe image.
- Strictly adhere to the visual descriptions above.
- Match all reference images EXACTLY for character and location consistency.
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

  const continuityNotes = previousScene
    ? `
CONTINUITY FROM SCENE ${previousScene.id}:
- Action Flows From: ${previousScene.description}
- Reference End Frame: ${previousScene.endFrame?.publicUri || "N/A"}
`
    : "First scene - establish baselines.";

  return `
VIDEO GENERATION PROMPT FOR SCENE ${scene.id}:

NARRATIVE & ACTION:
${scene.description}
Mood: ${scene.mood} (Intensity: ${scene.intensity})

VISUAL STYLE:
${buildCinematographerNarrative(scene)}
Lighting: ${scene.lighting.quality || "Standard"}, ${scene.lighting.colorTemperature || "Neutral"}.

CHARACTERS:
${characters.map((c) => buildCostumeAndMakeupNarrative(c)).join("\n\n")}
${characters.map(c => formatCharacterTemporalState(c)).join("\n")}

SETTING:
${buildProductionDesignerNarrative(location)}
${formatLocationTemporalState(location)}

CONTINUITY & INSTRUCTIONS:
${continuityNotes}
${scene.continuityNotes?.map((n) => `- ${n}`).join("\n") || ""}

${generationRules ? generationRules.map(r => `- ${r}`).join("\n") : ""}

DURATION: ${scene.duration}s
KEYFRAMES:
- Start: ${scene.startFrame?.publicUri || "Missing"}
- End: ${scene.endFrame?.publicUri || "Missing"}

Generate a coherent video clip transitioning between the provided keyframes, adhering to the narrative and visual details described.
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

    gaffer: `Lighting: ${scene.lighting.quality} (${scene.lighting.colorTemperature || "Neutral"})
Time of Day: ${location.timeOfDay}
Weather: ${location.weather || "Clear"}`,

    scriptSupervisor: previousScene
      ? `Continuity from Scene ${previousScene.id}:
- Previous action: ${previousScene.description}
- Previous lighting: ${previousScene.lighting.quality}
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
