export const promptVersion = "3.0.0-quality-control";

import { Character, Location, PromptCorrectionSchema, QualityIssueSchema, Scene, getJsonSchema } from "../../shared/pipeline-types";
import { formatCharacterSpecs, formatLocationSpecs } from "../utils";
import { composeDepartmentSpecs } from "./prompt-composer";
import { buildQualityControlVideoPrompt, buildQualityControlFramePrompt } from "./role-quality-control";

/**
   * Build comprehensive scene video evaluation prompt
   */
export const buildSceneVideoEvaluationPrompt = (
  scene: Scene,
  videoUrl: string,
  enhancedPrompt: string,
  schema: object,
  characters: Character[],
  location: Location,
  previousScene?: Scene,
  generationRules: string[] = []
): string => {
  // Compose department specifications for evaluation
  const departmentSpecs = composeDepartmentSpecs(
    scene,
    characters,
    location,
    previousScene
  );

  // Use role-based quality control prompt for video evaluation
  return buildQualityControlVideoPrompt(
    scene,
    videoUrl,
    enhancedPrompt,
    departmentSpecs,
    schema,
    characters,
    previousScene,
    generationRules
  );
};

// Legacy evaluation prompt (kept for reference/fallback)
const buildLegacySceneVideoEvaluationPrompt = (
  scene: Scene,
  videoUrl: string,
  enhancedPrompt: string,
  schema: object,
  characters: Character[],
  previousScene?: Scene,
): string => `As a professional video quality control specialist for a cinema production, evaluate this generated scene against the production requirements.

========================================
SCENE SPECIFICATIONS
========================================

Scene ID: ${scene.id}
Duration: ${scene.duration} seconds
Time Range: ${scene.startTime} - ${scene.endTime}

NARRATIVE INTENT:
${scene.description}

TECHNICAL REQUIREMENTS:
- Shot Type: ${scene.shotType}
- Camera Movement: ${scene.cameraMovement}
- Lighting: ${scene.lighting}
- Mood: ${scene.mood}
- Audio Sync: ${scene.audioSync}

MUSICAL CONTEXT:
- Musical Mood: ${scene.mood || "N/A"}
- Musical Intensity: ${scene.intensity || "N/A"}
- Musical Tempo: ${scene.tempo || "N/A"}

ENHANCED PROMPT USED:
${enhancedPrompt}

CHARACTERS IN SCENE:
${formatCharacterSpecs(characters)}

${previousScene ? `PREVIOUS SCENE CONTEXT:
Scene ${previousScene.id}:
- Description: ${previousScene.description}
- Lighting: ${previousScene.lighting}
- Characters: ${previousScene.characters.join(", ")}
- End Frame: ${previousScene.endFrame?.publicUri || "N/A"}
` : "This is the first scene - no previous context."}

========================================
EVALUATION CRITERIA
========================================

Evaluate the generated video (at ${videoUrl}) across 5 dimensions:

**1. NARRATIVE FIDELITY (30% weight)**
Does the video accurately represent the scene description's intent?
- Are the key story beats present?
- Does the action match what was described?
- Are the emotional beats correct?
- Is the pacing appropriate?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

**2. CHARACTER CONSISTENCY (25% weight)**
Do characters match their established appearance?
- Hair, clothing, accessories match reference specifications?
- Facial features consistent with previous scenes?
- Body language matches character psychology?
- Performance feels authentic to character?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

**3. TECHNICAL QUALITY (20% weight)**
Is the production quality cinema-grade?
- Camera work: Stable/smooth or intentionally dynamic?
- Framing: Composed well, proper headroom, rule of thirds?
- Lighting: Professional quality, motivated sources?
- Focus: Sharp where intended, appropriate depth of field?
- Resolution/artifacts: Clean image, no generation glitches?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

**4. EMOTIONAL AUTHENTICITY (15% weight)**
Does the scene feel human and emotionally truthful?
- Performances feel genuine (not stiff/robotic)?
- Emotional intensity matches the moment?
- Subtlety where needed, not over-acted?
- Body language and facial expressions align with emotion?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

**5. CONTINUITY (10% weight)**
Does this scene flow from the previous scene?
- Character positions make spatial sense?
- Lighting conditions are consistent or logically evolved?
- Props/costumes maintain state (torn stays torn, wet dries gradually)?
- Environmental continuity maintained?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

========================================
ISSUE IDENTIFICATION
========================================

For EACH issue found, provide:
${JSON.stringify(getJsonSchema(QualityIssueSchema))}

Critical issues: Break immersion, make video unusable
Major issues: Noticeable problems that hurt quality
Minor issues: Small imperfections that don't significantly impact experience

========================================
PROMPT CORRECTIONS (if regeneration needed)
========================================

If the video requires regeneration, provide specific prompt corrections:
${JSON.stringify(getJsonSchema(PromptCorrectionSchema))}

Examples of common issues and fixes:

**Issue: Character appearance inconsistency**
Original: "A woman with dark hair"
Corrected: "Elena: shoulder-length dark brown hair (exact match to reference image at [URL]), grey wool coat, silver compass necklace"
Reasoning: "Vague descriptions allow AI to deviate. Explicit reference anchoring enforces consistency."

**Issue: Wrong emotional tone**
Original: "Two people talking"
Corrected: "Elena and James, emotionally exhausted, voices barely above whispers, avoiding eye contact, shoulders slumped—two people at the end of their emotional rope"
Reasoning: "Generic 'talking' doesn't convey the weight. Specific emotional and physical descriptors guide performance."

**Issue: Poor lighting**
Original: "Night scene"
Corrected: "2:17 AM, warm amber streetlights creating pools of light every 30 feet, harsh shadows from overhead sources, faces half-lit in chiaroscuro style"
OUTPUT FORMAT
Reasoning: "Time specificity and motivated light sources create professional cinematic lighting."

**Issue: Spatial discontinuity**
Original: "They stand talking"
Corrected: "They stand 8 feet apart, Elena near the left streetlight, James under the right one, wet pavement between them reflecting their separated positions"
Reasoning: "Specific spatial positioning maintains geography and adds symbolic distance."

GENERATION RULE SUGGESTION (Optional)

Identify a fundamental flaw that is likely to recur in future scenes (e.g., inconsistent art style, persistent character distortion, incorrect lighting motifs), suggest a new, globally applicable "Generation Rule" to prevent it. This rule should be a concise, positive instruction.

- DO suggest rules for systemic issues (e.g., "All scenes must maintain a shallow depth of field (f/1.4-f/2.8) to isolate characters.")
- DO NOT suggest rules for scene-specific content (e.g., "The character should be smiling in this scene.")

Example \`ruleSuggestion\`: "Ensure all characters' facial structures strictly adhere to their reference images, maintaining consistent cheekbones, jawlines, and eye spacing across all scenes."

If no systemic issue is found, omit the \`ruleSuggestion\` field.

OUTPUT FORMAT
========================================
OUTPUT FORMAT
========================================

Return JSON in this exact structure:
${schema}

Be thorough but fair. Minor imperfections are acceptable. Focus on issues that significantly impact the viewer experience.`;

/**
   * Build comprehensive still frame evaluation prompt for video keyframe generation
   */
export const buildFrameEvaluationPrompt = (
  scene: Scene,
  frame: string,
  framePosition: "start" | "end",
  schema: object,
  characters: Character[],
  locations: Location[],
  previousFrame?: any,
  generationRules: string[] = []
): string => {
  // Get location for department specs
  const location = locations.find(l => l.id === scene.locationId) || locations[ 0 ];

  // Compose department specifications for evaluation
  const departmentSpecs = composeDepartmentSpecs(
    scene,
    characters,
    location
  );

  // Use role-based quality control prompt for frame evaluation
  return buildQualityControlFramePrompt(
    scene,
    frame,
    framePosition,
    departmentSpecs,
    schema,
    characters,
    locations,
    previousFrame,
    generationRules
  );
};

// Legacy frame evaluation prompt (kept for reference/fallback)
const buildLegacyFrameEvaluationPrompt = (
  scene: Scene,
  frame: string,
  framePosition: "start" | "end",
  schema: object,
  characters: Character[],
  locations: Location[],
): string => {
  const sceneCharacters = characters.filter(c => scene.characters.includes(c.id));

  if (!scene.locationId) throw Error("No locations in this scene.");
  const sceneLocation = locations.find(l => l.id === scene.locationId);
  if (!sceneLocation) throw Error("[buildLegacyFrameEvaluationPrompt]: Location not found");

  return `As a professional cinematography and VFX specialist evaluating keyframes for high-end video production, evaluate this generated still frame that will serve as a ${framePosition === "start" ? "starting" : "ending"} keyframe anchor for video generation.

This frame must work both as a standalone cinematic image AND as a reliable anchor point for generating the video sequence described below.

========================================
SCENE SPECIFICATIONS
========================================

Scene ID: ${scene.id}
Duration: ${scene.duration} seconds
Time Range: ${scene.startTime} - ${scene.endTime}
Intended Frame Position: ${framePosition === "start" ? "START" : "END"} of scene

NARRATIVE INTENT:
${scene.description}

TECHNICAL REQUIREMENTS:
- Shot Type: ${scene.shotType}
- Camera Movement: ${scene.cameraMovement}
- Lighting: ${scene.lighting}
- Mood: ${scene.mood}
- Audio Sync: ${scene.audioSync}

MUSICAL CONTEXT:
- Musical Mood: ${scene.mood || "N/A"}
- Musical Intensity: ${scene.intensity || "N/A"}
- Musical Tempo: ${scene.tempo || "N/A"}

CHARACTERS IN SCENE:
${formatCharacterSpecs(sceneCharacters)}

LOCATIONS IN SCENE:
${formatLocationSpecs([ sceneLocation ])}

========================================
KEYFRAME CONTEXT
========================================

This ${framePosition} frame will be paired with a ${framePosition === "start" ? "end" : "start"} frame to generate the complete video sequence.

PREVIOUS FRAME REFERENCE:
- Source: ${framePosition === "start" ? "End frame of previous scene" : "Start frame of current scene"}
- The previous frame is provided at: ${frame}
- Evaluate how well this frame transitions from/to that reference point

========================================
EVALUATION CRITERIA
========================================

Evaluate the generated still frame across 6 dimensions:

**1. NARRATIVE FIDELITY (25% weight)**
Does the frame accurately capture the scene description's intent for this specific moment?
- Are the key story beats visually present?
- Does the frozen action/pose match what was described?
- Are the emotional beats correctly captured in this still moment?
- Is the location/setting appropriate and recognizable?
- Does the composition tell the right story for a ${framePosition} frame?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

**2. CHARACTER CONSISTENCY (25% weight)**
Do characters match their established appearance and state?
- Hair, clothing, accessories match reference specifications?
- Facial features consistent with character references?
- Body language and poses match character psychology?
- Character positioning and scale appropriate?
- Are expressions captured at a good moment (not mid-blink, mid-word, awkward transition)?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

**3. KEYFRAME ANCHOR QUALITY (20% weight)**
Will this frame work effectively as a ${framePosition} keyframe for video generation?
- Composition is stable and well-suited for the intended camera movement?
- Character poses are clear and actionable (good starting/ending states for motion)?
- Spatial relationships are well-defined for video interpolation?
- Frame captures an appropriate moment (not an awkward in-between state)?
- Elements in the frame provide clear motion paths for video generation?
- Does this frame create a strong ${framePosition === "start" ? "launching point" : "destination point"} for the scene's action?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

**4. TECHNICAL QUALITY (15% weight)**
Is this a cinema-grade still frame with professional production values?
- Framing: Well-composed, proper headroom, effective use of rule of thirds?
- Lighting: Professional quality, motivated sources, appropriate mood?
- Focus: Sharp where intended, appropriate depth of field for the shot type?
- Resolution/artifacts: Clean image, no generation glitches, AI artifacts, or distortions?
- Motion blur: If present, is it intentional and cinematic (not a defect)?
- Image clarity: Sufficient detail for video generation to work from?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

**5. EMOTIONAL AUTHENTICITY (10% weight)**
Does this frozen moment feel human and emotionally truthful?
- Expressions and body language feel genuine (not stiff/artificial)?
- Emotional intensity appropriate for this moment in the scene?
- Subtlety where needed, not overacted or theatrical?
- Does the still frame capture the right emotional beat for its ${framePosition} position?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

**6. CROSS-SCENE CONTINUITY & TRANSITION QUALITY (5% weight)**
Does this frame work well with the previous frame reference?
- Smooth visual transition from the previous frame (${framePosition === "start" ? "end of prior scene" : "start of current scene"})?
- Character positions make spatial sense relative to previous frame?
- Lighting conditions are consistent or show logical progression?
- Props/costumes maintain state appropriately (damage, wetness, wear persist correctly)?
- Environmental continuity maintained (weather, time of day, setting details)?
- Does the ${framePosition === "start" ? "entry into this scene" : "exit from this scene"} feel natural?

Rate: PASS | MINOR_ISSUES | MAJOR_ISSUES | FAIL
Details: [Specific observations]

========================================
ISSUE IDENTIFICATION
========================================

For EACH issue found, provide:
${JSON.stringify(getJsonSchema(QualityIssueSchema))}

Severity definitions:
- **Critical**: Makes the frame unusable as a keyframe anchor or breaks narrative/character continuity
- **Major**: Significantly degrades quality or will cause problems in video generation
- **Minor**: Small imperfections that don't substantially impact usability or viewer experience

========================================
PROMPT CORRECTIONS (if regeneration needed)
========================================

If the frame requires regeneration, provide specific prompt corrections:
${JSON.stringify(getJsonSchema(PromptCorrectionSchema))}

Examples of common issues and fixes:

**Issue: Poor keyframe anchor - awkward transitional pose**
Original: "Character walking across the room"
Corrected: "${framePosition === "start" ? "Character beginning to walk, weight shifted to front foot, arms in natural walking position at sides, clear intent in body language" : "Character completing walking motion, weight settled on both feet in stable standing pose, arms naturally at rest"}"
Reasoning: "Keyframes need clear, stable poses that define motion endpoints. Vague 'walking' can generate mid-stride awkwardness."

**Issue: Character appearance inconsistency**
Original: "A woman with dark hair"
Corrected: "Elena: shoulder-length dark brown hair (exact match to reference image), grey wool coat, silver compass necklace, pale complexion, distinctive high cheekbones"
Reasoning: "Explicit reference details with distinctive features enforce consistency across keyframes and scenes."

**Issue: Wrong emotional tone captured**
Original: "Two people talking"
Corrected: "Elena and James, emotionally exhausted, faces frozen in pained expressions—Elena's eyes downcast avoiding contact, James's jaw clenched, shoulders visibly slumped—two people at the breaking point"
Reasoning: "Still frames need specific emotional descriptors for expressions. Generic 'talking' doesn't guide the captured moment."

**Issue: Poor composition for camera movement**
Original: "Wide shot of a room"
Corrected: "Wide shot establishing room geography: Elena ${framePosition === "start" ? "positioned frame-left with clear space frame-right for camera to track toward" : "positioned frame-right as final resting point after camera movement from left"}, 30% headroom for ${scene.cameraMovement}, background elements placed to guide eye toward intended motion path"
Reasoning: "Composition must accommodate the planned camera movement. ${framePosition} frames need appropriate spatial setup."

**Issue: Inadequate detail for video generation**
Original: "Night scene on a street"
Corrected: "2:17 AM, wet pavement reflecting warm amber streetlights spaced 30 feet apart creating pools of light, harsh overhead shadows in chiaroscuro style, practical light sources visible (street lamps at consistent height), atmospheric fog at ankle-level"
Reasoning: "Video generation needs concrete spatial and lighting details to interpolate between keyframes. Vague descriptions cause inconsistency."

**Issue: Cross-scene discontinuity**
Original: "Character in different location"
Corrected: "Elena transitioning from ${framePosition === "start" ? "the position she ended the previous scene—still near the doorway, coat still damp from rain, maintaining her exhausted posture" : "her starting position toward the window, coat beginning to dry, posture gradually straightening"}"
Reasoning: "${framePosition} frames must bridge scenes logically. Reference previous frame state and show appropriate progression."

========================================
GENERATION RULE SUGGESTION (Optional)
========================================

Identify a fundamental flaw likely to recur in future keyframes (e.g., inconsistent art style, persistent character distortion, poor keyframe pose selection, incorrect lighting motifs), suggest a new globally applicable "Generation Rule" to prevent it. This rule should be a concise, positive instruction applicable to keyframe generation broadly.

- DO suggest rules for systemic issues (e.g., "All keyframes must capture characters in clear, stable poses with weight fully settled—avoid mid-transition or mid-gesture moments.")
- DO NOT suggest rules for scene-specific content (e.g., "The character should be smiling in this scene.")

Example \`ruleSuggestion\`: "All ${framePosition} keyframes must show characters in complete, stable poses with clear spatial relationships—fully committed to either the beginning or end state of an action, never caught mid-motion, to ensure clean video interpolation."

If no systemic issue is found, omit the \`ruleSuggestion\` field.

========================================
OUTPUT FORMAT
========================================

Return JSON in this exact structure:
${schema}

Conduct thorough evaluation. Minor imperfections are acceptable if they don't impact the frame's usability as a keyframe anchor. Focus on issues that would:
1. Significantly impact viewer experience
2. Cause problems during video generation
3. Break character/scene continuity
4. Compromise the professional cinematic quality

Remember: This is a STILL FRAME evaluation, not a video sequence. Evaluate the frozen moment's quality and its suitability as a ${framePosition} keyframe anchor.`;
};