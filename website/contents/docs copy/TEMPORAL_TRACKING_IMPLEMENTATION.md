# Temporal Tracking Implementation Summary

## What Was Implemented

The Cinematic Framework now features a **comprehensive temporal state tracking system** that monitors and evolves character appearances and location conditions as the story progresses. This is now augmented by a robust **Media Synchronization Layer** ensuring all visual playback components align perfectly with the master audio timeline.

---

## Problem Addressed

**Before**: The framework relied on LLM instruction-following through prompts to maintain continuity, but lacked explicit data structures to track progressive changes like:
- ❌ Character injuries accumulating across scenes
- ❌ Costume damage persisting after combat
- ❌ Weather evolving logically throughout the day
- ❌ Dirt and exhaustion building up during action sequences
- ❌ Environmental damage (broken objects, debris) remaining across scenes

**After**: All progressive changes are now explicitly tracked in data structures and automatically evolved scene-by-scene based on narrative. Furthermore, client-side playback is now tightly synchronized across multiple video elements.

---

## Key Enhancements

### 1. Enhanced Type System ([pipeline/types.ts](pipeline/types.ts))

#### CharacterState Schema
**New Fields Added:**
```typescript
// Spatial continuity
lastExitDirection: "left" | "right" | "up" | "down" | "none"

// Emotional timeline
emotionalHistory: Array<{ sceneId: number, emotion: string }>

// Physical condition tracking
injuries: Array<{
  type: string,
  location: string,
  severity: "minor" | "moderate" | "severe",
  acquiredInScene: number
}>

// Progressive appearance changes
dirtLevel: "clean" | "slightly_dirty" | "dirty" | "very_dirty" | "covered"
exhaustionLevel: "fresh" | "slightly_tired" | "tired" | "exhausted" | "collapsing"
sweatLevel: "dry" | "slight" | "moderate" | "heavy" | "drenched"

// Costume degradation
costumeCondition: {
  tears: string[]      // ["sleeve torn", "pants ripped at knee"]
  stains: string[]     // ["blood on shirt", "mud on pants"]
  wetness: "dry" | "damp" | "wet" | "soaked"
  damage: string[]     // ["burned collar", "missing button"]
}

// Hair state changes
hairCondition: {
  style: string
  messiness: "pristine" | "slightly_messy" | "messy" | "disheveled" | "wild"
  wetness: "dry" | "damp" | "wet" | "soaked"
}
```

#### LocationState Schema (NEW)
```typescript
// Temporal progression
timeOfDay: string
timeHistory: Array<{ sceneId: number, timeOfDay: string }>

// Weather evolution
weather: string
weatherHistory: Array<{ sceneId: number, weather: string, intensity?: string }>
precipitation: "none" | "light" | "moderate" | "heavy"
visibility: "clear" | "slight_haze" | "hazy" | "foggy" | "obscured"

// Lighting changes
lighting: string
lightingHistory: Array<{ sceneId: number, lighting: string }>

// Ground surface changes
groundCondition: {
  wetness: "dry" | "damp" | "wet" | "soaked" | "flooded"
  debris: string[]   // ["broken glass", "rubble"]
  damage: string[]   // ["crater", "burn marks"]
}

// Object persistence
brokenObjects: Array<{
  object: string
  description: string
  brokenInScene: number
}>

// Atmospheric effects
atmosphericEffects: Array<{
  type: string       // "smoke", "fog", "dust"
  intensity: "light" | "moderate" | "heavy"
  addedInScene: number
  dissipating?: boolean
}>
```

### 2. State Evolution Engine ([pipeline/agents/state-evolution.ts](pipeline/agents/state-evolution.ts)) ✨ NEW FILE

**Core Functions:**
- `evolveCharacterState()` - Analyzes scene descriptions and updates character state
- `evolveLocationState()` - Analyzes scene descriptions and updates location state

**Detection Heuristics** (keyword-based parsing):

**Character Detection:**
- **Injuries**: "cut", "punch", "stab", "shot", "burn" → Adds injuries
- **Dirt**: "mud", "dirt", "dust", "crawl" → Increases dirt level
- **Exhaustion**: "run", "sprint", "fight", "climb" → Increases exhaustion
- **Sweat**: "sweat", "run", "heat", "hot" → Increases sweat level
- **Costume Damage**: "tear", "rip", "soak", "burn" → Updates costume condition
- **Hair Changes**: "wild hair", "disheveled", "wet" → Updates hair condition

**Location Detection:**
- **Weather**: "rain", "storm", "clear", "fog" → Updates weather state
- **Time**: "dawn", "morning", "noon", "dusk", "night" → Updates time of day
- **Ground**: (derived from weather) → Updates wetness, debris, damage
- **Broken Objects**: "shatter", "break", "smash" → Adds to broken objects
- **Atmospheric**: "smoke", "fog", "dust cloud" → Adds atmospheric effects

**Example Evolution:**
```typescript
Scene Description: "John runs through mud, tearing his sleeve"

Before:
  dirtLevel: "clean"
  exhaustionLevel: "fresh"
  costumeCondition.tears: []

After:
  dirtLevel: "slightly_dirty"        // ← "mud" detected
  exhaustionLevel: "slightly_tired"  // ← "runs" detected
  costumeCondition.tears: ["sleeve torn"]  // ← "tearing his sleeve" detected
```

### 3. Continuity Manager Updates ([pipeline/agents/continuity-manager.ts](pipeline/agents/continuity-manager.ts))

**Enhanced Initialization** (Lines 217-243):
- Characters initialized with complete state tracking fields
- Locations initialized with weather/environment tracking fields

**State Evolution Integration** (Lines 499-521):
```typescript
// OLD: Simple heuristic updates with hardcoded values
state: {
  position: scene.description.includes("left") ? "left" : "center",
  emotionalState: scene.mood,
  // weather: "neutral" ← NOT ACTUALLY TRACKED
}

// NEW: Full state evolution based on narrative
const evolvedState = evolveCharacterState(char, scene, scene.description);
return { ...char, state: evolvedState };
```

### 4. Prompt Composer Enhancements ([pipeline/prompts/prompt-composer.ts](pipeline/prompts/prompt-composer.ts))

**New Helper Functions:**
- `formatCharacterTemporalState()` - Formats character state for prompt injection
- `formatLocationTemporalState()` - Formats location state for prompt injection

**Prompt Injection** (Lines 223, 228, 279, 323):

**Before:**
```typescript
${c.name}:
- Hair: ${c.physicalTraits.hair}
- Clothing: ${c.physicalTraits.clothing}
```

**After:**
```typescript
${c.name}:
- Hair: ${c.physicalTraits.hair}
- Clothing: ${c.physicalTraits.clothing}
${formatCharacterTemporalState(c)}  // ← ADDS CURRENT STATE

// Example output:
// CURRENT STATE (MUST MAINTAIN):
//   - Injuries: cut on arm (minor)
//   - Dirt Level: dirty
//   - Exhaustion: tired
//   - Costume Tears: sleeve torn
```

---

## How It Works

### Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│ 1. INITIALIZATION (Before First Scene)                     │
│    Characters: pristine state (clean, fresh, no injuries)  │
│    Locations: baseline state (initial weather, no damage)  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. SCENE GENERATION                                         │
│    Director generates scene description:                   │
│    "John runs through warehouse, punched in fight"         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. STATE EVOLUTION (After Scene Generated)                 │
│    state-evolution.ts analyzes description:                │
│    - "runs" → exhaustionLevel: "slightly_tired"           │
│    - "punched" → injuries: [bruise on face (moderate)]    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. STATE UPDATE                                             │
│    continuity-manager.ts updates state:          │
│    character.state = evolvedState                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. NEXT SCENE PROMPT INJECTION                             │
│    prompt-composer.ts injects state into prompts:          │
│    "CURRENT STATE (MUST MAINTAIN):                         │
│     - Injuries: bruise on face (moderate)                  │
│     - Exhaustion: slightly tired"                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    (Repeat for each scene)
```

### Persistence Examples

#### Example 1: Injury Persistence
```
Scene 3: "Sarah gets cut on the arm during fight"
  → state.injuries = [{ type: "cut", location: "arm", severity: "minor", acquiredInScene: 3 }]

Scene 4: (Sarah appears in peaceful conversation)
  → Prompt includes: "Injuries: cut on arm (minor)"
  → Video generation shows cut still visible

Scene 8: (Sarah in another location)
  → state.injuries STILL contains the cut from Scene 3
  → Prompt still includes: "Injuries: cut on arm (minor)"
```

#### Example 2: Weather Progression
```
Scene 5: Location baseline: weather = "Clear"

Scene 6: Description = "Dark clouds roll in"
  → state.weather = "Cloudy"
  → state.visibility = "slight_haze"

Scene 7: Description = "Rain begins to fall"
  → state.weather = "Rain"
  → state.precipitation = "light"
  → state.groundCondition.wetness = "damp"

Scene 8: Description = "Torrential downpour"
  → state.weather = "Storm"
  → state.precipitation = "heavy"
  → state.groundCondition.wetness = "flooded"

Scene 9: (Still at same location)
  → Prompt includes: "Weather: Storm, Precipitation: heavy, Ground: flooded"
```

#### Example 3: Costume Damage Accumulation
```
Scene 2: "Shirt tears during struggle"
  → costumeCondition.tears = ["shirt torn"]

Scene 4: "Falls in mud puddle"
  → costumeCondition.tears = ["shirt torn"]  ← STILL THERE
  → costumeCondition.stains = ["mud on shirt"]

Scene 6: "Rain soaks clothing"
  → costumeCondition.tears = ["shirt torn"]  ← STILL THERE
  → costumeCondition.stains = ["mud on shirt"]  ← STILL THERE
  → costumeCondition.wetness = "soaked"

Scene 10: (Much later, same character)
  → ALL damage still tracked unless narrative indicates change
```

---

## Media Synchronization Layer (Client-Side Implementation) ✨ NEW

Significant changes were made to client components to synchronize playback across multiple `<video>` elements (main view and timeline previews) based on the master audio track's timeline.

### 1. Component Prop Changes

- **`PlaybackControls.tsx`**:
  - Now accepts `mainVideoRef: React.RefObject<HTMLVideoElement>` and `timelineVideoRefs: React.RefObject<HTMLVideoElement>[]`.
  - Added `onPlayMainVideo` callback.
  - Implemented logic for audio source switching: mutes intrinsic video audio if `audioUrl` is present, un-mutes otherwise.
  - Extended `animate` loop and `useEffect` hooks to synchronize `.currentTime` and call `.play()`/`.pause()` on all managed refs if global state changes.
  - Seeking logic (`handleSeek`) now calls `.currentTime = newTime` on all three video destinations (audio source, main video, timeline videos).

- **`SceneDetailPanel.tsx`**:
  - Props updated to receive `currentTime`, `isPlaying`, `audioUrl`, and `mainVideoRef`.
  - Implemented `useEffect` hooks to listen to `currentTime` and `isPlaying` to control its intrinsic video element, including muting based on `audioUrl`.
  - Play button now calls `onPlayMainVideo()` to trigger global playback start.

- **`Timeline.tsx`**:
  - Introduced `videoRefs = useRef<(HTMLVideoElement | null)[]>(new Array(scenes.length))` to capture individual scene video element references.
  - Added logic to control timeline videos directly (via `.play()`/`.pause()`) *only* when `audioUrl` is undefined, otherwise they follow the global time update.

### 2. Video Element Attribute Changes

- In both `SceneDetailPanel.tsx` and `Timeline.tsx`, the `<video>` elements now use `controls={false}` because playback is entirely controlled by the `PlaybackControls` component via reference manipulation.

---

## Conclusion

The temporal tracking system is now extended with a robust Media Synchronization Layer, ensuring visual consistency across all playback components precisely aligned with the master audio timeline, while state tracking for narrative elements is fully materialized.
