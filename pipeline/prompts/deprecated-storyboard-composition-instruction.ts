// deprecated
export const promptVersion = "3.0.0"

import { z } from "zod";
import { SceneSchema, StoryboardSchema } from "../../shared/pipeline-types";
import { buildDirectorSceneBeatPrompt } from "./role-director";
import { buildCinematographerGuidelines } from "./role-cinematographer";
import { buildGafferGuidelines } from "./role-gaffer";

export const buildStoryboardEnrichmentInstructions = (
  context: { isFirstBatch: boolean, batchNum: number, totalBatches: number; },
  jsonSchema: any
) => `You are enriching the storyboard for a cinematic music video.

CONTEXT: Processing BATCH ${context.batchNum} of ${context.totalBatches}

${context.isFirstBatch ?
    `YOUR PRIMARY MISSION:
Transform the provided creative prompt and musical analysis into a complete cinematic storyboard that synchronizes visual storytelling with the music's pace and emotional feel.

You're establishing:
- The visual language of this film
- Character personalities and arcs
- Location atmospheres and symbolic meaning
- The emotional through-line from first frame to last frame` :
    `YOUR CONTINUATION MISSION:
Maintain absolute consistency with established visual language, characters, and narrative momentum while advancing the story through this segment.`}

CINEMATIC REQUIREMENTS (THE MASTERFUL HUMAN DIRECTOR TOUCH):

**1. EMOTIONAL AUTHENTICITY**
Characters aren't props—they're living, breathing humans with inner lives.
- Subtle emotional shifts: A character's eyes reveal subtle emotion before their body language does
- Micro-expressions: Such as a slight downturn of the mouth, an impercetible hesitation
- Emotional memory: Previous scenes affect current behavior (pain lingers, joy radiates)
- Motivation visibility: Every action has a reason; viewers should sense it even if unstated

**2. VISUAL STORYTELLING MASTERY**
Every frame is intentional. Every one of your shot decisions has meaning and relevance to the narrative.
- Prefer realistic visuals (not surreal, psychedelic, or animated)
- Shot composition reveals human relationship dynamics (Such as low angle for dominance, high angle for vulnerability, etc)
- Camera movement reflects emotional state (Such as steady for stable, handheld for chaotic/intimate)
- Lighting motif creates mood. Consistent light quality must match scene tone (Such as harsh shadows for conflict, soft light for tenderness)
- Color temperature consistently evolves with emotional arc (Such as cool blues for emotional distance, warm golds for connection)

**3. SPATIAL & TEMPORAL CONTINUITY**
The world must appear real and consistent.
- Geographic consistency: Such as if a character exits frame-right, they enter the next shot from frame-left, and vice versa, etc
- Lighting logic: Sunlight positions stay consistent unless time passes
- Props & costume continuity: A torn sleeve stays torn; a worn jacket stays worn
- Physical consequences: Rain-soaked characters don't dry instantly; a wet shirt stays unless time passes

**4. NARRATIVE COHESION ACROSS TIME**
Whether 1 minute or 9 minutes, the story must feel complete.
- Clear beginning: Establish world, characters, and stakes of the narrative
- Escalating middle: Create tension, evolve relationships, deepen conflict
- Satisfying ending: Resolve or meaningfully conclude emotional arcs
- Pacing rhythm: Match story beats to musical phrases (climax with climax, bridge with aside, lull with rest, etc)

**5. PRODUCTION QUALITY STANDARDS**
This is cinema.
- Camera work: Intentional camera position and movement to suit the scene, dynamic movement when emotionally justified
- Lighting: Motivated light sources (windows, practicals, natural light), professional color grading
- Composition: Rule of thirds, leading lines, shot depth through foreground/background elements
- Blocking: Actors move with purpose to the scene benefit, not randomly
- Wardrobe continuity: Specific garments, colors, accessories remain consistent

**6. TRANSITION ARTISTRY**
Transitions are tools to aid the storytelling, not technical necessities. Establish a visual grammar and shot vocabulary: 

SMOOTH TRANSITIONS (Dissolve, Fade, Cross Fade, Wipe):
- Use when: Time passes, location changes gradually, mood softens or deepens
- Effect: nostalgic, dreamlike, natural flow
- Musical cue: Smooth melodic transitions, sustained notes, gentle shifts

SUDDEN TRANSITIONS (Hard Cut, Smash Cut, Jump Cut):
- Use when: Shock reveals, parallel actions, dramatic perspective shifts, high energy
- Effect: intentionally jarring, urgent
- Musical cue: aggressive downbeats, tempo spike, rhythmic breaks

CRITICAL: Transitions affect the ENTIRE FRAME as a unified layer.
- DO NOT transition "just the background" while characters remain static
- DO NOT transition "just the characters" while environment stays frozen
- Everything in frame (such as people, props, environment, lighting) transitions together as a unified layer (think post-production transition)

**7. MUSICAL SYNCHRONIZATION**
The music is your co-director.
- Match visual intensity to musical intensity (calm music = serene visuals, aggressive music = dynamic visuals)
- Align shot transitions to musical phrasing
- Lyrical sections can feature characters, dialogue, close-ups, character development, emotional beats
- Instrumental sections can feature establishing shots, action, atmosphere, character development, visual poetry
- Climactic moments: Align peak visual drama with musical climax

SCHEMA COMPLIANCE (CRITICAL):
You MUST populate ALL non-optional fields in the output_schema. Missing any fields is not acceptable and will break the pipeline.

INSTRUMENTAL SECTION GUIDANCE:
For scenes marked "[Instrumental]" or with placeholder descriptions:
- Create rich visual storytelling that bridges narrative gaps
- Use environment to reflect mood (weather, lighting, setting details)
- Show character reactions, temperament, or physical actions
- Build atmosphere that supports the music's emotional intent

CHARACTER EXTRACTION RULES:
Extract ALL human/creature entities from the creative prompt:
- Named characters: Extract exact names and physical descriptions
- Unnamed characters: Assign descriptive names ("The Woman", "First Guard")
- Groups: Define key individuals within groups ("Lead Expeditioner", "Caravan Guide")

LOCATION EXTRACTION RULES:
Identify ALL distinct settings:
- Major locations: "Ancient Egyptian Tomb", "Desert Dunes"
- Sub-locations: "Tomb Entrance", "Hall of the King", "Inner Labyrinth"
- Each location needs vivid sensory description (sights, implied sounds, atmosphere)

Return JSON exactly matching this schema. output_schema: ${JSON.stringify(jsonSchema, null, 2)}`;

