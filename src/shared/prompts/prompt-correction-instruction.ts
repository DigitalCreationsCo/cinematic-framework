import { PromptCorrection, Scene } from "../types/index.js";
import { buildSafetyGuidelinesPrompt } from "./safety-instructions.js";

export const buildCorrectionPrompt = (originalPrompt: string, scene: Scene, corrections: PromptCorrection[]) => `As a prompt refinement specialist, apply the following corrections to improve this video generation prompt.

ORIGINAL PROMPT:
${originalPrompt}

CORRECTIONS TO APPLY:
${corrections.map((c, i) => `
${i + 1}. [${c.department}] ${c.issueType}
   Original: "${c.originalPromptSection}"
   Corrected: "${c.correctedPromptSection}"
   Reasoning: ${c.reasoning}
`).join("\n")}

SCENE CONTEXT:
Scene ${scene.id}: ${scene.description}
Shot: ${scene.shotType} | Camera: ${scene.cameraMovement}
Mood: ${scene.mood} | Lighting: ${JSON.stringify(scene.lighting)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORRECTION PRINCIPLES (CRITICAL - READ CAREFULLY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. MAKE CORRECTIONS ADDITIVE, NOT REDUCTIVE:
   ❌ BAD: Remove details to simplify
   ✓ GOOD: Add specificity to eliminate ambiguity

   The corrected prompt should be MORE specific and detailed than the original.
   If you find yourself shortening sections, you're likely removing needed context.

2. BE EXPLICIT ABOUT SEMANTICS:
   ❌ BAD: "barrel of the wave"
   ✓ GOOD: "the hollow, curved interior tunnel of water formed by a breaking wave (NOT a physical tunnel, NOT a solid blue pipe structure, specifically liquid water forming a curved wall)"

   Add negative constraints to prevent misinterpretation.

3. SPECIFY EXACT COUNTS AND IDENTITIES:
   ❌ BAD: "group of surfers"
   ✓ GOOD: "exactly five surfers: [list each with name and distinguishing feature]"

4. CLARIFY SPATIAL RELATIONSHIPS AND MOTION:
   ❌ BAD: "running into the ocean"
   ✓ GOOD: "sprinting away from camera (backs visible) toward the ocean waterline, forward momentum clear, bodies leaning forward into motion"

5. ANCHOR CHARACTER SPECIFICATIONS:
   ❌ BAD: "young person"
   ✓ GOOD: "28-year-old male (masculine features: defined jawline, broad shoulders), matching reference image [specific features]"

6. PRESERVE WORKING CONTEXT:
   When applying corrections, keep all parts of the original prompt that are NOT being corrected.
   Only modify the specific sections identified in the corrections.

7. INCREASE SPECIFICITY:
   Expected outcome: Corrected prompt should be 10-30% LONGER than original
   If corrected prompt is shorter, you are likely removing important detail.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Apply ALL corrections to the original prompt
2. Maintain ALL other aspects of the prompt that aren't being corrected
3. Make corrections ADDITIVE - add detail, don't remove it
4. Add negative constraints where ambiguity exists (what it's NOT)
5. Ensure exact numbers, specific directions, explicit semantics
6. Anchor character identities with specific features from references
7. The corrected prompt should be more comprehensive and detailed

SAFETY GUIDELINES:
${buildSafetyGuidelinesPrompt()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Output ONLY the corrected prompt text.
Do NOT include JSON formatting, markdown code blocks, or any preamble.
Return raw text that can be used directly as a video generation prompt.`;