/**
 * PROMPT COMPOSER - Role-Based Prompt Composition Utilities
 *
 * This module provides helper functions for composing multi-role prompts
 * at various generation points in the workflow.
 */

import { Scene, Character, Location, QualityEvaluationResult, CharacterAttributes, LocationAttributes } from "../../shared/types/workflow.types";
import { buildDirectorSceneBeatPrompt } from "./role-director";
import { buildCinematographerGuidelines, buildCinematographerFrameComposition, buildCinematographerNarrative } from "./role-cinematographer";
import { buildGafferGuidelines, buildGafferLightingSpec } from "./role-gaffer";
import { buildScriptSupervisorContinuityChecklist } from "./role-script-supervisor";
import { buildCostumeAndMakeupSpec, buildCostumeAndMakeupNarrative } from "./role-costume-makeup";
import { buildProductionDesignerSpec, buildProductionDesignerNarrative } from "./role-production-designer";
import { formatCharacterSpecs, formatLocationSpecs } from "../../shared/utils/utils";

/**
 * Format character temporal state for prompts
 */
export const formatCharacterTemporalState = (character: Character): string => {
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
export const formatLocationTemporalState = (location: Location): string => {
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
  enhancedPrompt: string,
  characters: CharacterAttributes[],
  locations: LocationAttributes[],
  schema: string,
  audioContext?: string
) => `
You are enriching the storyboard for a cinematic music video.

CREATIVE PROMPT:
${enhancedPrompt}

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
 * Compose frame generation prompt meta instructions (Cinematographer + Gaffer + Script Supervisor)
 * Used in Generation Points 3.1 and 3.2
 */
export const composeFrameGenerationPromptMeta = (
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
    ? characters.map((c) => `${buildCostumeAndMakeupNarrative(c)}
${formatCharacterTemporalState(c)}`).join("\n\n")
    : "No specific characters in this shot.";

  return `${cinematography}

${scene.description}

MOOD: ${scene.mood}

CHARACTERS:
${characterNarratives}

ENVIRONMENT:
${locationNarrative}
${location ? formatLocationTemporalState(location) : ""}

Lighting specifications for Scene ${scene.id}:
${buildGafferLightingSpec(scene, location, location?.timeOfDay)}

${buildScriptSupervisorContinuityChecklist(scene, previousScene, characters, locations)}

REFERENCE IMAGES:
${previousScene && framePosition === "start" ? `- Previous scene end frame` : ""}
${characters.map((c) => `- ${c.name} Reference Image`).join("\n")}
${location ? `- ${location.name} Reference Image` : ""}

${composeGenerationRules(generationRules)}

INSTRUCTIONS:
- Generate a photorealistic ${framePosition} keyframe image.
- Strictly adhere to the visual descriptions above.
- Match all reference images EXACTLY for character and location consistency.
`;
};


// TESTING VIDEO OUTPUTS:
// NOTE: EXPERIMENT WITH A PREFACE 'CINEMATIC DIRECTOR / PRODUCER' HEADING AND WITHOUT
// a/b test prompts on 2 scenes each
/**
 * Compose enhanced scene prompt for video generation
 * Used in Generation Point 3.3
 */
export const composeEnhancedSceneGenerationPromptMetav1 = (
  scene: Scene,
  characters: Character[],
  locations: Location[],
  previousScene?: Scene,
  generationRules?: string[],
): string => {

  const previousSceneAssets = previousScene?.assets;
  const sceneAssets = scene?.assets;
  const startFrame = sceneAssets[ 'scene_start_frame' ]?.versions[ sceneAssets[ 'scene_start_frame' ].best ].data;
  const endFrame = sceneAssets[ 'scene_end_frame' ]?.versions[ sceneAssets[ 'scene_end_frame' ].best ].data;
  const continuityNotes = previousScene
    ? `
CONTINUITY FROM PREVIOUS SCENE ${previousScene.id}:
- Action Flows From: ${previousScene.description}
- Reference End Frame: ${previousSceneAssets?.[ 'scene_end_frame' ]?.versions[ previousSceneAssets[ 'scene_end_frame' ].best ].data || "N/A"}
`
    : "First scene.";

  const characterNarratives = characters.length > 0
    ? characters.map((c) => `${buildCostumeAndMakeupNarrative(c)}
${formatCharacterTemporalState(c)}`).join("\n\n")
    : "No specific characters in this shot.";
  const location = locations.find((l) => l.id === scene.locationId)!;

  return `Scene ID: ${scene.id}

${buildCinematographerNarrative(scene)}

${scene.description}

Mood: ${scene.mood} (Intensity: ${scene.intensity})
- Duration: ${scene.duration}s

Lighting: ${JSON.stringify(scene.lighting, null, 2)}

Characters:
${characterNarratives}

Environment (Location & Atmosphere):
${buildProductionDesignerNarrative(location)}
${formatLocationTemporalState(location)}

${buildGafferLightingSpec(scene, location, location?.timeOfDay)}
${continuityNotes}
${scene.continuityNotes?.map((n) => `- ${n}`).join("\n") || ""}

${buildScriptSupervisorContinuityChecklist(scene, previousScene, characters, locations)}

REFERENCE IMAGES:
${startFrame && `- Start Frame: ${startFrame}` || ""}
${endFrame && `- End Frame: ${endFrame}` || ""}

${composeGenerationRules(generationRules)}

INSTRUCTIONS:
1. Synthesize all the above information into a SINGLE, cohesive paragraph.
2. Focus on VISUAL details, MOVEMENT, and ATMOSPHERE.
3. Explicitly describe the camera movement and lighting as per the cinematography specs.
4. Ensure character appearance and state (injuries, dirt, costume) are accurately described.
5. Optimize the prompt for high-end video generation (like LTX-Video or Sora).
6. Do NOT include phrases like "Here is the prompt" or "Scene Description:". Just output the prompt text itself.
7. If there are generation rules, ensure the prompt strictly adheres to them.

OUTPUT FORMAT:
Return only the prompt text.
`;
};

export const composeEnhancedSceneGenerationPromptMetav2 = (
  scene: Scene,
  characters: Character[],
  location: Location,
  previousScene?: Scene,
  generationRules?: string[],
): string => {

  const previousSceneAssets = previousScene?.assets;
  const sceneAssets = scene?.assets;
  const startFrame = sceneAssets[ 'scene_start_frame' ]?.versions[ sceneAssets[ 'scene_start_frame' ].best ].data;
  const endFrame = sceneAssets[ 'scene_end_frame' ]?.versions[ sceneAssets[ 'scene_end_frame' ].best ].data;
  const continuityNotes = previousScene
    ? `
CONTINUITY FROM SCENE ${previousScene.id}:
- Action Flows From: ${previousScene.description}
- Reference End Frame: ${previousSceneAssets?.[ 'scene_end_frame' ]?.versions[ previousSceneAssets[ 'scene_end_frame' ].best ].data || "N/A"}
`
    : "First scene.";

  const characterNarratives = characters.length > 0
    ? characters.map((c) => `${buildCostumeAndMakeupNarrative(c)}
${formatCharacterTemporalState(c)}`).join("\n\n")
    : "No specific characters in this shot.";

  return `Scene ID: ${scene.id}

${buildCinematographerNarrative(scene)}

${scene.description}

Mood: ${scene.mood} (Intensity: ${scene.intensity})
- Duration: ${scene.duration}s

Lighting: ${JSON.stringify(scene.lighting, null, 2)}

CHARACTERS:
${characterNarratives}

SETTING (Location & Atmosphere):
${buildProductionDesignerNarrative(location)}
${formatLocationTemporalState(location)}

CONTINUITY REQUIREMENTS:
${continuityNotes}
${scene.continuityNotes?.map((n) => `- ${n}`).join("\n") || ""}

REFERENCE IMAGES:
${startFrame && `- Start Frame: ${startFrame}` || ""}
${endFrame && `- End Frame: ${endFrame}` || ""}

${composeGenerationRules(generationRules)}

INSTRUCTIONS FOR WRITING THE PROMPT:
1. Synthesize all the above information into a SINGLE, cohesive paragraph.
2. Focus on VISUAL details, MOVEMENT, and ATMOSPHERE.
3. Explicitly describe the camera movement and lighting as per the cinematography specs.
4. Ensure character appearance and state (injuries, dirt, costume) are accurately described.
5. The prompt should be optimized for a high-end video generation model (like LTX-Video or Sora).
6. Do NOT include phrases like "Here is the prompt" or "Scene Description:". Just output the prompt text itself.
7. If there are generation rules, ensure the prompt strictly adheres to them.

OUTPUT FORMAT:
Return only the prompt text.
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

    gaffer: `Lighting: ${JSON.stringify(scene.lighting, null, 2)}
Time of Day: ${location.timeOfDay}
Weather: ${location.weather || "Clear"}`,

    scriptSupervisor: previousScene
      ? `Continuity from Scene ${previousScene.id}:
- Previous action: ${previousScene.description}
- Previous lighting: ${JSON.stringify(previousScene.lighting)}
- Continuity notes: ${scene.continuityNotes?.join("; ") || "Standard continuity"}`
      : "First scene - baseline established",

    costume: characters
      .map(
        (c) => `${c.name}:
Hair: ${c.physicalTraits.hair}
Clothing: ${typeof c.physicalTraits.clothing === "string" ? c.physicalTraits.clothing : c.physicalTraits.clothing?.join(", ")}
Accessories: ${c.physicalTraits.accessories?.join(", ") || "None"}
Reference: ${c.assets[ 'location_image' ]?.versions[ c.assets[ 'location_image' ]?.best ].data || "N/A"}`
      )
      .join("\n\n"),

    productionDesign: `${location.name}:
Type: ${location.type || "Unspecified"}
Time of Day: ${location.timeOfDay}
Key Elements: ${[ ...(location.naturalElements || []), ...(location.manMadeObjects || []) ].join(", ")}
Reference: ${location.assets[ 'location_image' ]?.versions[ location.assets[ 'location_image' ]?.best ].data || "N/A"}`,
  };
};

export function composeGenerationRules(generationRules?: string[]) {
  const rules = generationRules && generationRules.length > 0 ? `
  The following rules are MANDATORY constraints. Any violation is a CRITICAL FAILURE.
  Must explicitly check the asset against each GENERATION RULE.
  If any rule is violated, must report it as a MAJOR or CRITICAL issue.
  
  GENERATION RULES COMPLIANCE (STRICT):
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ${generationRules.map(r => `• ${r}`).join('\n')}
  ` : "";

  return rules;
}

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
