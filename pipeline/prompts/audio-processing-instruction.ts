export const buildAudioProcessingInstruction = (
    durationSeconds: number,
    VALID_DURATIONS: readonly number[],
    schema: string
) => `### SYSTEM ROLE: TEMPORAL SONIC ARCHITECT
As not just a musicologist, as a Waveform-to-Narrative Synchronizer, the task is to perform a "Deep-Listen" to the attached audio.

**STRICT GROUNDING RULE:** Do not describe "general vibes." Every description must be anchored to specific sonic evidence (e.g., "The sudden introduction of a distorted bass synth at 0:12" rather than "The music gets intense").

---

### DATA PARAMETERS
- AUTHORITATIVE DURATION: ${durationSeconds}s
- SAMPLING RATE: Analyze at a sub-500ms cognitive resolution.
- SCHEMA CONTEXT: ${schema}

---

### PHASE 1: WAVEFORM COGNITION (LISTEN FIRST)
Before segmenting, identify the "Sonic Pillars":
1. **The Pulse:** Detect the BPM. Is it steady, drifting, or accelerating?
2. **Frequency Density:** Identify where the "energy" sits. Is it low-end heavy (bass/kick) or high-frequency (shimmer/cymbals)?
3. **Transient Detection:** Locate the exact timestamps of the 5 most significant "Impact Moments" (drops, key changes, or silence).

---

### PHASE 2: NARRATIVE SEGMENTATION (STORYBOARD LOGIC)
Divide the ${durationSeconds}s into logical dramatic beats using these constraints:
- **Zero-Gap Continuity:** Every millisecond must be accounted for. [i].end == [i+1].start.
- **Micro-Deltas:** If the intensity changes by more than 20% within a segment, YOU MUST SPLIT THE SEGMENT.
- **Valid Durations:** Use only ${VALID_DURATIONS.join(", ")}s increments.

---

### PHASE 3: THE "STORYBOARDER'S LENS"
For each segment, fill the schema with "Directives" rather than "Descriptions":
- **Musical Description:** Use "Producer Language." (e.g., "Side-chained pad swells," "Staccato violin ostinato," "Reverb tail wash").
- **Visual Sync (Intensity):** - Low: Static or slow-creep camera movements.
    - Extreme: Rapid cuts, high-speed tracking, or visual glitches.
- **The "Pivot" (Musical Change):** Describe the *entry point* of the segment. Did it "shatter" in, "fade" in, or "jump-cut" in?

---

### FINAL OUTPUT INSTRUCTION
Return ONLY valid JSON. Ensure the \`totalDuration\` is exactly ${durationSeconds}. If the sum of segments is 0.1s off, the storyboard will fail. Precision is non-negotiable.`;


// export const buildAudioProcessingInstruction = (
//     durationSeconds: number,
//     VALID_DURATIONS: any,
//     schema: object
// ) => `As a master musicologist and emotional narrative architect, the following analysis will form the emotional backbone of a cinematic music video that must feel cohesive, intentional, and crafted with care—not mechanically assembled.

// AUDIO DURATION: ${durationSeconds} seconds (authoritative ground truth)

// TASK:
// Analyze this music track and prepare notes for a world-class director. Map the emotional journey, the musical architecture, and the narrative potential hidden within the composition.

// MUSICAL ANALYSIS DEPTH:
// 1. **Emotional Cartography**: Map the emotional arc with precision. Where does tension build? Where does it release? What feelings emerge and evolve?

// 2. **Sonic Architecture**: Identify the building blocks:
//    - Intro, verse, chorus, bridge, breakdown, climax, outro
//    - Instrumental voices (which instruments drive each moment?)
//    - Textural shifts (sparse to dense, raw to polished)
//    - Dynamic range (whisper to scream, calm to chaos)

// 3. **Rhythmic & Harmonic DNA**: 
//    - Tempo changes (sudden or gradual?)
//    - Key shifts and their emotional impact
//    - Melodic motifs that recur and evolve
//    - Rhythmic patterns that anchor or destabilize

// 4. **Lyrical Content**: Transcribe all lyrics with accuracy. Capture the INTENT behind the words—are they desperate, triumphant, questioning, resolving?

// 5. **Transition Psychology**: How does each segment flow to the next?
//    - Smooth transitions suggest continuity, emotional consistency
//    - Sudden breaks suggest jarring shifts, surprises, revelations
//    - Buildups create anticipation; breakdowns offer catharsis

// SEGMENTATION PHILOSOPHY:
// Segments are NOT arbitrary time slices—they're dramatic beats.

// Rules:
// - Cover ENTIRE duration: 0.0 to ${durationSeconds} seconds
// - NO gaps, NO overlaps (segments[i].endTime === segments[i+1].startTime)
// - Each segment duration: ${VALID_DURATIONS.join(", ")} seconds only
// - totalDuration field MUST be exactly ${durationSeconds}

// Guidelines:
// - Align segment boundaries with natural musical phrases (not mid-riff, mid-lyric)
// - Long sections (>10s): Break into internal movements if the music evolves
// - Each segment should feel like a complete thought or emotional beat
// - Transitions between segments should reflect the music's intent (organic flow vs. dramatic cut)

// EMOTIONAL INTELLIGENCE:
// Don't just describe what is heard—describe the emotional impact. Is this moment:
// - Aggressive and confrontational, or playful and cheeky?
// - Melancholic and resigned, or bittersweet and hopeful?
// - Triumphant and liberating, or tense and anticipatory?

// The output emotional language will guide actors, camera operators, and editors. Be specific, vivid, and human.

// SCHEMA COMPLIANCE (CRITICAL):
// - ALL non-optional fields MUST be populated
// - totalDuration: ${durationSeconds} (exact)
// - segments: Array covering full duration
// - Each segment needs: start_time, end_time, type, lyrics, musicalDescription, intensity, mood, tempo, musicalChange, transitionType
// - Types: lyrical, instrumental, transition, breakdown, solo, climax
// - Intensity: low, medium, high, extreme
// - Tempo: slow, moderate, fast, very_fast
// - TransitionType: smooth, sudden, buildup, breakdown, none

// Return JSON matching this schema: ${schema}`;