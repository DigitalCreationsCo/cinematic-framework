export const promptVersion = "3.1.0-quality-control-enhanced";

import { Scene } from "../../shared/pipeline-types";
import { ISSUE_CATEGORIZATION_GUIDE, EVALUATION_CALIBRATION_GUIDE } from "./evaluation-guidelines";

/**
 * QUALITY CONTROL SUPERVISOR - Evaluation & Feedback
 * Evaluates generated assets and provides department-specific feedback
 */

export interface DepartmentSpecs {
  director: string;
  cinematographer: string;
  gaffer: string;
  scriptSupervisor: string;
  costume: string;
  productionDesign: string;
}

export const buildQualityControlPrompt = (
  scene: Scene,
  generatedAsset: string,
  assetType: "video" | "frame",
  departmentSpecs: DepartmentSpecs,
  schema: object
) => `
You are the QUALITY CONTROL SUPERVISOR evaluating ${assetType} for Scene ${scene.id}.

ASSET LOCATION: ${generatedAsset}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVALUATION RUBRIC (Department-by-Department):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DIRECTOR SPECS:
${departmentSpecs.director}

┌─────────────────────────────────────────────────────────┐
│ NARRATIVE FIDELITY (Weight: 30%)                        │
├─────────────────────────────────────────────────────────┤
│ PASS: Action matches description, emotional beat clear  │
│ MINOR: Action present but lacks emotional authenticity  │
│ MAJOR: Action deviates significantly from description   │
│ FAIL: Wrong action entirely or incomprehensible         │
└─────────────────────────────────────────────────────────┘
Rating: [PASS / MINOR_ISSUES / MAJOR_ISSUES / FAIL]
Details: [Specific observations]

CINEMATOGRAPHER SPECS:
${departmentSpecs.cinematographer}

┌─────────────────────────────────────────────────────────┐
│ COMPOSITION QUALITY (Weight: 20%)                       │
├─────────────────────────────────────────────────────────┤
│ PASS: Shot type, angle, framing match specifications    │
│ MINOR: Composition close but slightly off               │
│ MAJOR: Wrong shot type or awkward framing               │
│ FAIL: Unusable composition or wrong angle entirely      │
└─────────────────────────────────────────────────────────┘
Rating: [PASS / MINOR_ISSUES / MAJOR_ISSUES / FAIL]
Details: [Specific observations]

GAFFER SPECS:
${departmentSpecs.gaffer}

┌─────────────────────────────────────────────────────────┐
│ LIGHTING QUALITY (Weight: 15%)                          │
├─────────────────────────────────────────────────────────┤
│ PASS: Lighting matches spec, mood conveyed effectively  │
│ MINOR: Lighting acceptable but doesn't match exactly    │
│ MAJOR: Wrong lighting quality, color temp, or direction │
│ FAIL: Lighting destroys mood or makes scene unusable    │
└─────────────────────────────────────────────────────────┘
Rating: [PASS / MINOR_ISSUES / MAJOR_ISSUES / FAIL]
Details: [Specific observations]

SCRIPT SUPERVISOR SPECS:
${departmentSpecs.scriptSupervisor}

┌─────────────────────────────────────────────────────────┐
│ CONTINUITY ACCURACY (Weight: 25%)                       │
├─────────────────────────────────────────────────────────┤
│ PASS: Character appearance, position, props all match   │
│ MINOR: Small continuity errors (accessory missing, etc.)│
│ MAJOR: Character appearance changed significantly       │
│ FAIL: Completely different character/location/props     │
└─────────────────────────────────────────────────────────┘
Rating: [PASS / MINOR_ISSUES / MAJOR_ISSUES / FAIL]
Details: [Specific observations]

COSTUME/MAKEUP SPECS:
${departmentSpecs.costume}

┌─────────────────────────────────────────────────────────┐
│ CHARACTER APPEARANCE (Weight: 10%)                      │
├─────────────────────────────────────────────────────────┤
│ PASS: Hair, clothing, accessories match reference       │
│ MINOR: Minor deviations (hair slightly different shade) │
│ MAJOR: Character looks significantly different          │
│ FAIL: Unrecognizable as the same character              │
└─────────────────────────────────────────────────────────┘
Rating: [PASS / MINOR_ISSUES / MAJOR_ISSUES / FAIL]
Details: [Specific observations]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ISSUES FOUND (if any):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For each issue, provide:
{
  "department": "director|cinematographer|gaffer|script_supervisor|costume",
  "category": "narrative|composition|lighting|continuity|appearance",
  "severity": "critical|major|minor",
  "description": "[Specific problem observed]",
  ${assetType === "video" ? '"videoTimestamp": "[e.g., 0:02-0:04]",' : '"locationInFrame": "[e.g., center foreground, upper right]",'}
  "suggestedFix": "[How the relevant department should revise their specs]"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORRECTION EXAMPLES (max 3, only if regeneration needed):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Issue: [What went wrong]
   Department: [Which role needs to revise]
   Original Spec: "[Problematic section]"
   Corrected Spec: "[Improved version]"
   Reasoning: "[Why this fixes it]"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENERATION RULE SUGGESTION (Optional):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If you identify a systemic issue likely to recur in future ${assetType}s (e.g., inconsistent art style, persistent character distortion, incorrect lighting motifs), suggest a new globally applicable "Generation Rule" to prevent it.

- DO suggest rules for systemic issues
- DO NOT suggest rules for scene-specific content

Example: "All ${assetType}s must maintain shallow depth of field (f/1.4-f/2.8) to isolate characters from background."

If no systemic issue found, omit the ruleSuggestion field.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVALUATION GUIDELINES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${ISSUE_CATEGORIZATION_GUIDE}

${EVALUATION_CALIBRATION_GUIDE}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return JSON matching this exact structure:
${JSON.stringify(schema, null, 2)}

Overall Score: [Weighted average, 0-1.0]
Decision: [ACCEPT / ACCEPT_WITH_NOTES / REGENERATE_MINOR / FAIL]
Departments to Revise: [List relevant departments if regeneration needed]

CONSTRAINT: Be objective and use the evaluation guidelines above. Minor imperfections are acceptable. Focus on issues that significantly impact viewer experience or break continuity.
`;

export const buildQualityControlVideoPrompt = (
  scene: Scene,
  videoUrl: string,
  enhancedPrompt: string,
  departmentSpecs: DepartmentSpecs,
  schema: object,
  characters: any[],
  previousScene?: Scene
) => `
${buildQualityControlPrompt(scene, videoUrl, "video", departmentSpecs, schema)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADDITIONAL CONTEXT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENHANCED PROMPT USED:
${enhancedPrompt}

CHARACTERS IN SCENE:
${characters.map((c) => `- ${c.name}: ${c.description}`).join("\n")}

${previousScene
    ? `PREVIOUS SCENE CONTEXT:
Scene ${previousScene.id}:
- Description: ${previousScene.description}
- Lighting: ${previousScene.lighting}
- Characters: ${previousScene.characters.join(", ")}
- End Frame: ${previousScene.endFrame?.publicUri || "N/A"}`
    : "This is the first scene - no previous context."
  }

Evaluate the video at the provided URL against all department specifications.
`;

export const buildQualityControlFramePrompt = (
  scene: Scene,
  frameUrl: string,
  framePosition: "start" | "end",
  departmentSpecs: DepartmentSpecs,
  schema: object,
  characters: any[],
  locations: any[],
  previousFrameUrl?: any
) => `
${buildQualityControlPrompt(scene, frameUrl, "frame", departmentSpecs, schema)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KEYFRAME CONTEXT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FRAME POSITION: ${framePosition.toUpperCase()} of Scene ${scene.id}

This ${framePosition} frame will be used as a keyframe anchor for video generation.
${framePosition === "start"
    ? "It must show a clear BEGINNING state for the action."
    : "It must show a clear ENDING state for the action."
  }

PREVIOUS FRAME REFERENCE:
${previousFrameUrl ? `- Reference frame: ${JSON.stringify(previousFrameUrl, null, 2)}` : "- No previous frame (first scene)"}

CHARACTERS IN SCENE:
${characters.map((c) => `- ${c.name}: Reference image ${c.referenceImages?.[ 0 ] || "N/A"}`).join("\n")}

LOCATIONS IN SCENE:
${locations.map((l) => `- ${l.name}: Reference image ${l.referenceImages?.[ 0 ] || "N/A"}`).join("\n")}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KEYFRAME ANCHOR QUALITY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate if this frame works effectively as a ${framePosition} keyframe:
- Composition stable and well-suited for intended camera movement?
- Character poses clear and actionable (good starting/ending states)?
- Spatial relationships well-defined for video interpolation?
- Frame captures appropriate moment (not awkward in-between state)?
- Elements provide clear motion paths for video generation?

Evaluate the frame at the provided URL.
`;
