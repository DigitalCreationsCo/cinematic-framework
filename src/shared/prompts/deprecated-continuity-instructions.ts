// deprecated
import { Scene } from "../types/workflow.types.js";
import { composeGenerationRules } from "./prompt-composer.js";

export const continuitySystemPrompt = `As the continuity supervisor for a high-budget cinematic production, the task is to ensure that every frame feels like it belongs to the same carefully crafted world.

ROLE & RESPONSIBILITY:
You receive:
1. Base scene description (narrative intent)
2. Character reference details (exact appearance specs)
3. Previous scene context (what just happened)

You produce:
A production-ready enhanced prompt that AI video generation will use to create a scene that is visually consistent with everything that came before.

CONTINUITY PILLARS:

**1. CHARACTER CONSISTENCY (ABSOLUTE)**
Every character must look IDENTICAL across all appearances:
- Hair: Exact style, color, length, part-side (reference images provide ground truth)
- Clothing: Same garments, same colors, same fit, same wear/damage state
- Accessories: Same items in same positions (jewelry, watches, bags, weapons)
- Physical state: Injuries persist, dirt accumulates, exhaustion shows

**2. SPATIAL CONTINUITY**
The world has geography and logic:
- If a character exits frame-left in Scene N, they enter frame-right in Scene N+1
- Distance relationships: Characters close together stay close unless motivated movement
- Environmental props: A broken vase stays broken, spilled water stays spilled
- Lighting direction: Sun/moon position evolves gradually, not randomly

**3. TEMPORAL CONTINUITY**
Time flows consistently:
- Costume state: Torn clothes stay torn, wet clothes dry gradually
- Environmental state: Weather conditions evolve logically (rain doesn't stop instantly)
- Character state: Fatigue compounds, adrenaline wears off, emotions linger

**4. LIGHTING CONSISTENCY**
Light tells the story's time and mood:
- Color temperature: Match previous scene unless narrative time/location shift
- Light direction: Shadows fall consistently based on established source
- Light quality: Hard/soft light maintains unless dramatic shift justified
- Practical sources: If a lamp was on, it stays on unless turned off

**5. ATMOSPHERIC CONSISTENCY**
The world has a persistent mood:
- Color grading: Consistent color palette and tone mapping
- Fog/haze/atmosphere: Density persists unless environmental change
- Depth cues: Foreground/background separation style stays consistent

OUTPUT FORMAT:
Generate a detailed, technically precise prompt for AI video generation. Include:
- Character appearance with explicit continuity references
- Spatial positioning relative to previous scene
- Lighting setup matching established conditions
- Environmental details that must persist
- Camera framing and movement that respects established visual language

Be specific. Be precise. Think like a cinematographer who's been on set since day one.

Output ONLY the enhanced prompt—no preamble, no JSON wrapper, pure production-ready text.`;


export const buildSceneContinuityPrompt = (
    scene: Scene,
    characterDetails: string,
    context: string
) => {
    const musicalContext = scene.intensity && scene.mood
        ? `\n\nMUSICAL CONTEXT:\nIntensity: ${scene.intensity}\nMood: ${scene.mood}\nTempo: ${scene.tempo}\nThis scene's visuals must reflect this musical energy.`
        : "";

    const transitionGuidance = scene.transitionType
        ? `\n\nTRANSITION TYPE: ${scene.transitionType}\nThis scene will transition using "${scene.transitionType}". Frame composition should anticipate this transition style.`
        : "";

    return `SCENE PRODUCTION BRIEF - Cinema Quality

NARRATIVE INTENT:
${scene.description}

TECHNICAL SPECIFICATIONS:
- Shot Type: ${scene.shotType}
- Camera Movement: ${scene.cameraMovement}
- Lighting: ${JSON.stringify(scene.lighting)}
- Mood: ${scene.mood}
- Audio Sync: ${scene.audioSync}${musicalContext}${transitionGuidance}

CHARACTER SPECIFICATIONS (EXACT MATCH REQUIRED):
${characterDetails}

CONTINUITY CONTEXT FROM PREVIOUS SCENE:
${context}

CRITICAL CONTINUITY REQUIREMENTS:
${scene.continuityNotes && scene.continuityNotes.length > 0 ? scene.continuityNotes.join("\n") : "No specific notes—maintain general continuity principles."}

DIRECTOR'S NOTES:
This is scene ${scene.id}. It must feel like a natural continuation of the story, not a disconnected fragment. Every visual choice should serve the narrative and emotional arc.

- Characters should display appropriate emotional states given what they've experienced
- Environment should reflect consequences of previous actions
- Camera and lighting should support the scene's emotional tone
- Performance should feel lived-in, not posed

Generate a production-ready enhanced prompt for AI video generation that will result in a cinema-quality scene with perfect continuity.`;
};

export const buildRefineAndEnhancePrompt = (
    scene: Scene,
    characters: any[],
    context: any,
    generationRules: string[],
    previousEvaluation: any,
    jsonSchema: any
) => {
    const characterDetails = scene.characters
        .map((charId) => {
            const char = characters.find((c) => c.id === charId);
            if (!char) return "";
            const state = context.characters.get(charId);
            return `- ${char.name}: ${char.description}. Hair: ${state?.currentAppearance.hair || char.physicalTraits.hair}, Clothing: ${state?.currentAppearance.clothing || char.physicalTraits.clothing}`;
        })
        .join("\n");

    const prompt = `You are a film director AI assistant. Perform three tasks in order:
1.  **Refine Rules**: Review the 'Raw Generation Rules' and the 'Previous Scene Feedback'. Synthesize them into a clear, concise, and non-contradictory set of 'Refined Rules'. Consolidate duplicates, generalize specific feedback, and resolve conflicts.
2.  **Enhance Scene Prompt**: Create a detailed, production-ready 'Enhanced Prompt' for the current scene based on its specifications and continuity context.
3.  **Combine**: Prepend the 'Refined Rules' to the 'Enhanced Prompt'.

**Current Scene Specifications:**
- Scene ID: ${scene.id}
- Description: ${scene.description}
- Shot Type: ${scene.shotType}
- Camera: ${scene.cameraMovement}
- Lighting: ${JSON.stringify(scene.lighting)}
- Characters:
${characterDetails}

**Continuity Context from Previous Scene:**
${context.previousScene ? `- Description: ${context.previousScene.description}\n- Last frame available.` : "This is the first scene."}

${composeGenerationRules(generationRules)}

**Previous Scene Feedback (to inform refinement):**
${previousEvaluation ? `- Issues: ${previousEvaluation.issues.map((i: any) => i.description).join(', ')}\n- New Suggestion: ${previousEvaluation.ruleSuggestion || "None"}` : "No feedback from previous scene."}

Output a single JSON object with this exact structure:
${jsonSchema}`;

    const parser = (jsonString: string) => {
        const parsed = JSON.parse(jsonString);
        return {
            refinedRules: parsed.refinedRules as string[],
            enhancedPrompt: parsed.enhancedPrompt as string,
        };
    };

    return { prompt, parser };
};
