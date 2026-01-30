export const promptVersion = "3.0.0-director";

import { AudioAnalysisAttributes, SceneAttributes, VALID_DURATIONS } from "../types/index.js";
import { buildSafetyGuidelinesPrompt } from "./safety-instructions.js";

/**
 * DIRECTOR - Creative Vision & Story Development
 * Establishes overall creative vision, characters, locations, and scene beats
 */

export const buildDirectorVisionPrompt = (
  title: string,
  userPrompt: string,
  schema?: string,
  audioSegments?: AudioAnalysisAttributes[ 'segments' ],
  totalDuration?: number,
) => {
  const audioContext = audioSegments
    ? `Musical Structure: ${audioSegments.length} segments
Mood Range: ${audioSegments[ 0 ]?.mood || "N/A"} → ${audioSegments[ audioSegments.length - 1 ]?.mood || "N/A"}
Duration: ${totalDuration || 0}s`
    : "No audio provided - establish pacing based on creative intent";

  return `You are the DIRECTOR establishing the creative vision for a cinematic music video.

INPUT:
Creative Concept: ${userPrompt}
${audioContext}

OUTPUT REQUIRED (4 sections only):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. CONCEPT & VISION (2-3 sentences)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Title: ${`"${title}"` || "Generate a compelling, emotionally resonant title that fits the story’s theme, tone, and intent."}
- Logline: One sentence capturing the core story
- Visual Style: [Realistic/stylized/noir/vibrant/desaturated - pick one]
- Emotional Arc: [Beginning mood] → [Middle evolution] → [Ending resolution]
- Narrative Structure: [Linear/parallel storylines/flashback/circular - pick one]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. CHARACTERS (Each character requires):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: [Descriptive if unnamed: "The Surfer", "Lead Contestant"]
Age: [Specific number or range like "28-30"]
Physical Build: [Height descriptor, body type - be concrete]
Face: [Shape, prominent features, skin tone - NO celebrity references]
Hair: [Exact color, length, style, texture]
Clothing: [List specific garments with colors, fit, condition]
Accessories: [Jewelry, bags, props - list each item]
Emotional State: [How they feel entering this story]
Character Arc: [What changes for them from start to end - 1 sentence]
Key Actions: [3-5 specific VISIBLE things they DO in the video]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. LOCATIONS (Each location requires):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: [Specific place]
Type: [Beach/urban street/warehouse/forest/etc.]
Time of Day: [Exact time like "2:30 PM golden hour", "pre-dawn 5:45 AM"]
Weather: [Clear/overcast/foggy/raining/snowing]
Key Visual Elements: [List 5-7 specific things visible: "palm trees", "graffiti wall", "wet pavement"]
Atmosphere: [Bustling/abandoned/tense/peaceful - concrete descriptor]
Color Palette: [3-5 dominant colors in this location]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. SCENE BEAT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For each musical segment or narrative beat:

Scene ID: [Number]
Timing: [Start time]-[End time] ([Duration]s)
Musical Context: [Mood, intensity, tempo if audio provided]
Action: [What happens - 2 sentences max, VISIBLE action only]
Character Positions: [Who is where - left/center/right, foreground/background]
Emotional Beat: [What this moment conveys - be specific]
Transition to Next: [Smooth/sudden/buildup/breakdown - with reason]

CONSTRAINTS:
- NO philosophical language about "authenticity" or "being human"
- NO dialogue or sonic descriptions (this is VISUAL medium)
- NO vague terms like "powerful" or "impactful" - use concrete descriptors
- Characters MUST be described generically (NO celebrity likeness)
- If age < 18, describe as "young adult (18-20 years old)"
- Each scene action MUST be VISUALLY OBSERVABLE (no internal thoughts)
- Scene durations MUST be ${VALID_DURATIONS.join(", ")} seconds ONLY
- It is not your job to generate urls - any urls, be sure to leave them empty or undefined.

SAFETY REQUIREMENTS:
${buildSafetyGuidelinesPrompt()}

OUTPUT: 
${schema ? `Structured data matching the schema provided (JSON):
  ${schema}` : ''}
`;
};

export const buildDirectorSceneBeatPrompt = () => `
DIRECTOR SCENE SPECIFICATIONS:

For each scene, specify:

NARRATIVE INTENT (2-3 sentences):
- What happens in this scene (VISIBLE action only)
- Who is present and what they're doing
- What this moment means emotionally

CHARACTER ACTIONS & POSITIONS:
- Character name: [Action] at [Position: left/center/right/foreground/background]
- Character name: [Action] at [Position]
(List all characters in scene)

EMOTIONAL BEAT:
[Be specific: "mounting tension", "relief and joy", "quiet determination" - not "powerful"]

MUSICAL CONTEXT (if provided):
- Mood: [From audio analysis]
- Intensity: [low/medium/high/extreme]
- Tempo: [slow/moderate/fast/very_fast]

TRANSITION TYPE:
[Smooth/sudden/buildup/breakdown] because [reason]

CONSTRAINTS:
- Focus on observable action (not internal states)
- Characters must be positioned clearly for cinematographer
- Emotional beat must guide lighting and camera choices
`;
