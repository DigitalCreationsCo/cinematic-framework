# Temporal State Tracking System

## Overview

The Cinematic Framework now includes a comprehensive **temporal state tracking system** that monitors and evolves character and location states throughout the story progression. This system ensures that progressive changes (injuries, dirt accumulation, weather evolution, costume damage, etc.) are tracked and maintained across scenes for realistic continuity.

## Architecture

### Core Components

1. **Enhanced Type Schemas** ([pipeline/types.ts](pipeline/types.ts))
   - `CharacterStateSchema` - Tracks character progression
   - `LocationStateSchema` - Tracks location/environment progression

2. **State Evolution Engine** ([pipeline/agents/state-evolution.ts](pipeline/agents/state-evolution.ts))
   - `evolveCharacterState()` - Analyzes scene descriptions and updates character state
   - `evolveLocationState()` - Analyzes scene descriptions and updates location state
   - Heuristic-based parsers for detecting changes from narrative text

3. **Continuity Manager Integration** ([pipeline/agents/continuity-manager.ts](pipeline/agents/continuity-manager.ts))
   - Initializes baseline states for all characters and locations
   - Calls state evolution logic after each scene generation
   - Updates `storyboardState` with evolved states

4. **Prompt Composer Integration** ([pipeline/prompts/prompt-composer.ts](pipeline/prompts/prompt-composer.ts))
   - `formatCharacterTemporalState()` - Formats character state for prompts
   - `formatLocationTemporalState()` - Formats location state for prompts
   - Injects current state into frame and scene generation prompts

---

## Character State Tracking

### Tracked Properties

#### 1. Spatial Continuity
```typescript
position: string                    // left/center/right, foreground/background
lastExitDirection: "left" | "right" | "up" | "down" | "none"
```

**Purpose**: Maintains spatial logic across scenes (e.g., if character exits left in Scene 3, they should enter right in Scene 4).

#### 2. Emotional Progression
```typescript
emotionalState: string
emotionalHistory: Array<{
  sceneId: number;
  emotion: string;
}>
```

**Purpose**: Tracks emotional arc across scenes. Not just the current emotion, but the full timeline for character development analysis.

#### 3. Physical Condition
```typescript
physicalCondition: string  // Human-readable summary
injuries: Array<{
  type: string;              // "cut", "bruise", "gunshot wound", etc.
  location: string;          // "arm", "leg", "head", etc.
  severity: "minor" | "moderate" | "severe";
  acquiredInScene: number;
}>
```

**Purpose**: Tracks injuries that persist across scenes. A cut acquired in Scene 2 will still be visible in Scene 10 unless narrative indicates healing.

#### 4. Appearance Degradation
```typescript
dirtLevel: "clean" | "slightly_dirty" | "dirty" | "very_dirty" | "covered"
exhaustionLevel: "fresh" | "slightly_tired" | "tired" | "exhausted" | "collapsing"
sweatLevel: "dry" | "slight" | "moderate" | "heavy" | "drenched"
```

**Purpose**: Progressive accumulation of dirt, exhaustion, and sweat based on scene activities. Resets only when narrative indicates rest or cleaning.

#### 5. Costume State
```typescript
costumeCondition: {
  tears: string[];           // ["sleeve torn", "pants ripped at knee"]
  stains: string[];          // ["blood on shirt", "mud on pants"]
  wetness: "dry" | "damp" | "wet" | "soaked"
  damage: string[];          // ["burned collar", "missing button"]
}
```

**Purpose**: Tracks progressive costume damage. A torn shirt in Scene 3 remains torn in all subsequent scenes unless changed.

#### 6. Hair Condition
```typescript
hairCondition: {
  style: string;             // Should match baseline unless narrative justification
  messiness: "pristine" | "slightly_messy" | "messy" | "disheveled" | "wild"
  wetness: "dry" | "damp" | "wet" | "soaked"
}
```

**Purpose**: Tracks hair state changes (wind, water, combat) while ensuring baseline style remains consistent.

---

## Location State Tracking

### Tracked Properties

#### 1. Temporal Progression
```typescript
timeOfDay: string
timeHistory: Array<{
  sceneId: number;
  timeOfDay: string;
}>
```

**Purpose**: Tracks time-of-day evolution across scenes. Morning scenes logically progress to afternoon, sunset, night, etc.

#### 2. Weather Evolution
```typescript
weather: string
weatherHistory: Array<{
  sceneId: number;
  weather: string;
  intensity?: "light" | "moderate" | "heavy" | "extreme"
}>
precipitation: "none" | "light" | "moderate" | "heavy"
visibility: "clear" | "slight_haze" | "hazy" | "foggy" | "obscured"
```

**Purpose**: Weather evolves logically. Clear skies can become cloudy, rain can intensify or dissipate, fog can roll in or clear.

#### 3. Lighting Progression
```typescript
lighting: string
lightingHistory: Array<{
  sceneId: number;
  lighting: string;
}>
```

**Purpose**: Tracks lighting changes across scenes for consistency with time-of-day and weather.

#### 4. Ground Condition
```typescript
groundCondition: {
  wetness: "dry" | "damp" | "wet" | "soaked" | "flooded"
  debris: string[];          // ["broken glass", "fallen leaves", "rubble"]
  damage: string[];          // ["crater", "burn marks", "impact site"]
}
```

**Purpose**: Ground wetness accumulates with rain, dries with sun. Debris and damage persist across scenes.

#### 5. Object Persistence
```typescript
brokenObjects: Array<{
  object: string;
  description: string;
  brokenInScene: number;
}>
```

**Purpose**: Broken objects stay broken. A shattered window in Scene 2 remains shattered in Scene 8.

#### 6. Atmospheric Effects
```typescript
atmosphericEffects: Array<{
  type: string;              // "smoke", "fog", "dust", "steam"
  intensity: "light" | "moderate" | "heavy"
  addedInScene: number;
  dissipating?: boolean;
}>
```

**Purpose**: Atmospheric effects (smoke, fog, dust clouds) linger across scenes and gradually dissipate over time.

#### 7. Environmental Context
```typescript
season: "spring" | "summer" | "fall" | "winter" | "unspecified"
temperatureIndicators: string[]  // ["frost on windows", "heat shimmer", "steam breath"]
```

**Purpose**: Maintains seasonal consistency and temperature visual cues across scenes.

---

## Media Synchronization Layer (New Feature)

Building upon explicit temporal tracking, a new synchronization layer coordinates playback across multiple `<video>` elements: the main display video, and potentially multiple smaller timeline preview videos.

### Core Synchronization Logic

**1. External Audio Priority**: If an external `audioUrl` is provided (e.g., a music track), the framework prioritizes this audio source.
   - The main video's intrinsic audio source is **muted** (`mainVideoRef.current.muted = true;`).
   - The external audio track controls the master time progression via animation frame loop.

**2. Intrinsic Audio Fallback**: If no `audioUrl` is present, the main video's intrinsic audio controls the timing.
   - The intrinsic video's audio track is **unmuted** (`mainVideoRef.current.muted = false;`).

**3. Multi-Video Time Sync**: The global `currentTime` derived from the master audio source is forcefully applied to all managed video elements:
   - **Main Video**: Synchronized on play/pause/seek/time update.
   - **Timeline Videos**: Each scene's preview video element (referenced via `timelineVideoRefs`) is updated to match `currentTime`.

**4. Playback Control Integration** (`PlaybackControls.tsx`):
   - The component now manages refs for all associated video elements (`mainVideoRef`, `timelineVideoRefs`).
   - Global play/pause toggles the playing state of all associated videos simultaneously.
   - Seeking updates all video elements instantly.
   - Looping logic now correctly resets `currentTime`, `audioRef.current.currentTime`, and `mainVideoRef.current.currentTime`.

**5. Scene Detail Panel Integration** (`SceneDetailPanel.tsx`):
   - Now uses `mainVideoRef` to directly control the video element it renders, managing its play/pause state based on global context (`isPlaying`).
   - Also handles muting logic relative to the presence of an external `audioUrl`.

### Component Interfaces Impacted

- `PlaybackControlsProps`: Added `mainVideoRef`, `timelineVideoRefs`, `onPlayMainVideo`.
- `SceneDetailPanelProps`: Renamed `onPlayVideo` to `onPlayMainVideo`, added video refs and time context.
- `TimelineProps`: Added `currentTime`, `isPlaying`, `audioUrl`, and added `onSetTimelineVideoRefs` for ref propagation.

**Key Concept**: Playback is now centrally managed by time, decoupling play state from individual video element controls, ensuring all visual representations align perfectly with the master audio track.

---

## State Evolution Workflow

### 1. Initialization (First Scene)

When assets are generated ([continuity-manager.ts:217-243](pipeline/agents/continuity-manager.ts#L217-L243)):

```typescript
// Characters initialized with pristine state
state: {
  lastSeen: undefined,
  position: "center",
  lastExitDirection: "none",
  emotionalState: "neutral",
  emotionalHistory: [],
  physicalCondition: "healthy",
  injuries: [],
  dirtLevel: "clean",
  exhaustionLevel: "fresh",
  sweatLevel: "dry",
  costumeCondition: { tears: [], stains: [], wetness: "dry", damage: [] },
  hairCondition: { style: character.physicalTraits.hair, messiness: "pristine", wetness: "dry" }
}
```

### 2. Scene-by-Scene Evolution

After each scene is generated ([continuity-manager.ts:499-509](pipeline/agents/continuity-manager.ts#L499-L509)):

```typescript
const updatedCharacters = currentStoryboardState.characters.map((char: Character) => {
  if (scene.characters.includes(char.id)) {
    // Evolve character state based on scene narrative
    const evolvedState = evolveCharacterState(char, scene, scene.description);
    return { ...char, state: evolvedState };
  }
  return char;
});
```

### 3. Heuristic Detection

The state evolution engine ([state-evolution.ts](pipeline/agents/state-evolution.ts)) uses keyword-based heuristics to detect changes:

**Character Detection Examples:**
- `"runs through mud"` → Increases `dirtLevel`
- `"punched in the face"` → Adds injury: `{ type: "bruise", location: "face", severity: "moderate" }`
- `"tears shirt"` → Adds to `costumeCondition.tears`: `"shirt torn"`
- `"soaked by rain"` → Sets `costumeCondition.wetness: "soaked"`

**Location Detection Examples:**
- `"storm rolls in"` → Updates `weather: "Storm"`, `precipitation: "heavy"`
- `"window shatters"` → Adds to `brokenObjects`: `{ object: "window", description: "shattered", brokenInScene: X }`
- `"thick smoke fills room"` → Adds to `atmosphericEffects`: `{ type: "smoke", intensity: "heavy" }`

### 4. Prompt Injection

When generating frames or scenes ([prompt-composer.ts:223,228](pipeline/prompts/prompt-composer.ts#L223)):

```typescript
${characters.map((c) => `
  ${buildCostumeAndMakeupSpec(c)}
  ${formatCharacterTemporalState(c)}  // ← Injects current state
`).join("\n\n")}
```

**Example Output:**
```
CHARACTER: John Smith
- Hair: Short dark brown
- Clothing: Black leather jacket, jeans
- Reference Image: [URL]

CURRENT STATE (MUST MAINTAIN):
  - Injuries: cut on arm (minor), bruise on face (moderate)
  - Dirt Level: dirty
  - Exhaustion: tired
  - Costume Stains: blood on shirt, mud on pants
  - Costume Tears: sleeve torn
```

**Example Location Output:**
```
LOCATION CURRENT STATE (MUST MAINTAIN):
  - Time of Day: dusk
  - Weather: Rain
  - Precipitation: moderate
  - Ground: wet
```

---

## Detection Heuristics Reference

### Character State Keywords

| Category | Keywords | Effect |
|----------|----------|--------|
| **Dirt** | mud, dirt, dust, soil, crawl, roll | Increases `dirtLevel` |
| **Cleaning** | clean, wash, shower, bath, wipe | Resets `dirtLevel` to "clean" |
| **Exhaustion** | run, sprint, chase, fight, climb | Increases `exhaustionLevel` |
| **Rest** | sit, relax, recover | Decreases `exhaustionLevel` |
| **Injuries** | cut, slash, punch, stab, shot, burn | Adds to `injuries` array |
| **Costume Tears** | tear, rip, torn, ripped | Adds to `costumeCondition.tears` |
| **Costume Wetness** | soak, drench, wet, rain, splash | Updates `costumeCondition.wetness` |
| **Hair Messiness** | wild hair, disheveled, tangled | Updates `hairCondition.messiness` |

### Location State Keywords

| Category | Keywords | Effect |
|----------|----------|--------|
| **Weather** | rain, storm, snow, fog, clear, sunny | Updates `weather` |
| **Time** | dawn, morning, noon, afternoon, dusk, night | Updates `timeOfDay` |
| **Precipitation** | heavy rain, downpour, drizzle, sprinkle | Updates `precipitation` level |
| **Visibility** | haze, obscured, can't see | Updates `visibility` |
| **Ground Wetness** | (derived from weather + precipitation) | Updates `groundCondition.wetness` |
| **Debris** | glass, rubble, trash, wreckage | Adds to `groundCondition.debris` |
| **Damage** | crater, burn marks, explosion, impact | Adds to `groundCondition.damage` |
| **Broken Objects** | shatter, break, smash, destroy, collapse | Adds to `brokenObjects` |
| **Atmospheric** | smoke, fog, dust cloud, steam, mist | Adds to `atmosphericEffects` |

---

## Integration Points

### 1. Asset Generation
- **When**: Before first scene generation
- **Where**: [continuity-manager.ts:217-243](pipeline/agents/continuity-manager.ts#L217-L243)
- **Action**: Initialize baseline states for all characters and locations

### 2. State Update
- **When**: After each scene is generated
- **Where**: [continuity-manager.ts:493-537](pipeline/agents/continuity-manager.ts#L493-L537)
- **Action**: Evolve states based on scene narrative

### 3. Frame Generation
- **When**: Before generating start/end keyframes
- **Where**: [prompt-composer.ts:192-257](pipeline/prompts/prompt-composer.ts#L192-L257)
- **Action**: Inject current state into image generation prompt

### 4. Video Generation
- **When**: Before generating scene video
- **Where**: [prompt-composer.ts:264-376](pipeline/prompts/prompt-composer.ts#L264-L376)
- **Action**: Inject current state into video generation prompt

### 5. Quality Evaluation
- **When**: After scene video is generated
- **Where**: Quality Check Agent
- **Action**: Verify that temporal state is maintained in generated content

---

## Usage Examples

### Example 1: Chase Sequence with Progressive Exhaustion

**Scene 1 Description**: "John runs through the warehouse"
- **State After**: `exhaustionLevel: "slightly_tired"`

**Scene 2 Description**: "John sprints down the alley, breathing heavily"
- **State After**: `exhaustionLevel: "tired"`, `sweatLevel: "moderate"`

**Scene 3 Description**: "John climbs fire escape, struggling"
- **State After**: `exhaustionLevel: "exhausted"`, `sweatLevel: "heavy"`

**Prompt in Scene 3**:
```
CURRENT STATE (MUST MAINTAIN):
  - Exhaustion: exhausted
  - Sweat: heavy
```

### Example 2: Combat with Injuries and Costume Damage

**Scene 5 Description**: "Punch lands on Sarah's face, tearing her sleeve"
- **State After**:
  - `injuries: [{ type: "bruise", location: "face", severity: "moderate" }]`
  - `costumeCondition.tears: ["sleeve torn"]`

**Scene 6 Description**: "Sarah fires back, blood visible on her face"
- **State After**: (injuries persist)
  - `injuries: [{ type: "bruise", location: "face", severity: "moderate" }]`
  - `costumeCondition.tears: ["sleeve torn"]`
  - `costumeCondition.stains: ["blood on face"]`

**Prompt in Scene 7**:
```
CURRENT STATE (MUST MAINTAIN):
  - Injuries: bruise on face (moderate)
  - Costume Stains: blood on face
  - Costume Tears: sleeve torn
```

### Example 3: Weather Progression

**Scene 10 Location State**:
- `weather: "Clear"`, `precipitation: "none"`

**Scene 11 Description**: "Dark clouds roll in overhead"
- **State After**: `weather: "Cloudy"`, `visibility: "slight_haze"`

**Scene 12 Description**: "Rain begins to fall, light at first"
- **State After**: `weather: "Rain"`, `precipitation: "light"`, `groundCondition.wetness: "damp"`

**Scene 13 Description**: "Torrential downpour, streets flooding"
- **State After**: `weather: "Storm"`, `precipitation: "heavy"`, `groundCondition.wetness: "flooded"`

**Prompt in Scene 13**:
```
LOCATION CURRENT STATE (MUST MAINTAIN):
  - Weather: Storm
  - Precipitation: heavy
  - Ground: flooded
```

### Example 4: Environmental Damage Persistence

**Scene 8 Description**: "Explosion shatters the window, debris everywhere"
- **State After**:
  - `brokenObjects: [{ object: "window", description: "shattered", brokenInScene: 8 }]`
  - `groundCondition.debris: ["glass"]`
  - `groundCondition.damage: ["explosion"]`
  - `atmosphericEffects: [{ type: "smoke", intensity: "heavy", addedInScene: 8 }]`

**Scene 9**: (different part of same location)
- **State**: Shattered window and debris still present
- **State**: Smoke marked as `dissipating: true` (2+ scenes later)

**Scene 10**: (returns to explosion site)
- **State**: Window still shattered, glass debris still present, smoke fully dissipated

**Prompt in Scene 10**:
```
LOCATION CURRENT STATE (MUST MAINTAIN):
  - Debris: glass
  - Environmental Damage: explosion
  - Broken Objects: window shattered
```

---

## Benefits

### 1. Realistic Continuity
- Characters don't magically heal between scenes
- Costume damage persists throughout the story
- Weather evolves logically rather than randomly resetting

### 2. Reduced Manual Oversight
- System automatically tracks progressive changes
- Prompt engineering embeds state requirements directly
- Quality checks validate state maintenance

### 3. Narrative Consistency
- Injuries from Scene 2 are still visible in Scene 15
- Broken windows stay broken unless repaired
- Exhaustion accumulates during action sequences

### 4. Visual Coherence
- Dirt accumulation looks natural
- Weather progression feels realistic
- Environmental damage persists appropriately

### 5. Character Development
- Emotional history provides arc tracking
- Physical condition reflects story intensity
- Appearance degradation mirrors narrative journey

---

## Limitations and Future Enhancements

### Current Limitations

1. **Heuristic-Based Detection**
   - Relies on keyword matching rather than semantic understanding
   - May miss implicit state changes not explicitly mentioned
   - Can't detect nuanced changes (e.g., "slightly more tired")

2. **No Healing/Recovery Progression**
   - Injuries don't gradually heal over many scenes
   - Exhaustion resets only on explicit rest keywords
   - No automatic "time-based" recovery

3. **No Contextual Awareness**
   - Doesn't understand narrative intent (e.g., time skip)
   - Can't infer state changes from previous context
   - Limited understanding of cause-and-effect chains

4. **Single-Location Tracking**
   - Location states track the last-used state
   - Doesn't maintain different states for different areas of same location
   - No "room-by-room" state tracking

### Future Enhancement Opportunities

1. **LLM-Powered State Analysis**
   - Use LLM to analyze scene description and suggest state updates
   - Validate heuristic-detected changes with semantic understanding
   - Generate more nuanced state progressions

2. **Temporal Recovery Models**
   - Gradually heal minor injuries over time
   - Implement fatigue recovery rates
   - Model costume damage worsening or improving

3. **Multi-Level Location States**
   - Track sub-location states (e.g., "warehouse main floor" vs "warehouse office")
   - Maintain per-room object states
   - Support location state branching

4. **State Change Suggestions**
   - Propose logical state changes based on narrative
   - Alert when detected state contradicts previous state
   - Recommend continuity fixes

5. **Historical State Queries**
   - Query: "What did Character X look like in Scene 5?"
   - Query: "When did Location Y get damaged?"
   - Generate temporal state reports

6. **State Visualization**
   - Timeline view of character condition over scenes
   - Weather progression graphs
   - Injury/damage accumulation charts

---

## API Reference

### State Evolution Functions

#### `evolveCharacterState(character, scene, sceneDescription): CharacterState`

**Parameters:**
- `character: Character` - The character to evolve
- `scene: Scene` - The current scene being generated
- `sceneDescription: string` - The scene's narrative description

**Returns:** Updated `CharacterState` with evolved properties

**Usage:**
```typescript
const evolvedState = evolveCharacterState(
  currentCharacter,
  scene,
  "John runs through mud, tearing his jacket"
);
// evolvedState.dirtLevel: "slightly_dirty"
// evolvedState.costumeCondition.tears: ["jacket torn"]
```

#### `evolveLocationState(location, scene, sceneDescription): LocationState`

**Parameters:**
- `location: Location` - The location to evolve
- `scene: Scene` - The current scene being generated
- `sceneDescription: string` - The scene's narrative description

**Returns:** Updated `LocationState` with evolved properties

**Usage:**
```typescript
const evolvedState = evolveLocationState(
  currentLocation,
  scene,
  "Storm intensifies, rain pounds the windows"
);
// evolvedState.weather: "Storm"
// evolvedState.precipitation: "heavy"
```

### Prompt Formatting Functions

#### `formatCharacterTemporalState(character): string`

**Parameters:**
- `character: Character` - Character with state to format

**Returns:** Formatted string for prompt injection

**Example Output:**
```
CURRENT STATE (MUST MAINTAIN):
  - Injuries: cut on arm (minor), bruise on face (moderate)
  - Dirt Level: dirty
  - Exhaustion: tired
```

#### `formatLocationTemporalState(location): string`

**Parameters:**
- `location: Location` - Location with state to format

**Returns:** Formatted string for prompt injection

**Example Output:**
```
CURRENT STATE (MUST MAINTAIN):
  - Time of Day: dusk
  - Weather: Rain
  - Precipitation: moderate
  - Ground: wet
```

---

## Testing

To test temporal tracking:

1. **Create a test storyboard** with progressive narrative:
   ```typescript
   Scene 1: "Character enters clean warehouse"
   Scene 2: "Character fights, gets punched"
   Scene 3: "Character crawls through dust"
   Scene 4: "Character stands, exhausted"
   ```

2. **Verify state evolution** after each scene:
   ```typescript
   console.log(storyboardState.characters[0].state);
   // Should show accumulated injuries, dirt, exhaustion
   ```

3. **Check prompt injection**:
   ```typescript
   const prompt = composeEnhancedSceneGenerationPrompt(scene, characters, location);
   console.log(prompt);
   // Should contain "CURRENT STATE" section with accumulated changes
   ```

4. **Validate generated content**:
   - Visually inspect generated frames/videos
   - Verify injuries, dirt, costume damage are visible
   - Confirm weather/lighting consistency

---

## Troubleshooting

### State Not Updating

**Symptom**: Character/location state unchanged after scene
**Causes**:
- Scene description doesn't contain trigger keywords
- Heuristic detection failed to parse change
- State evolution not called in workflow

**Solutions**:
- Add more explicit keywords to scene descriptions
- Enhance detection heuristics in `state-evolution.ts`
- Verify `updateStoryboardState()` is called after scene generation

### State Over-Accumulating

**Symptom**: Characters become unrealistically dirty/exhausted
**Causes**:
- Too aggressive escalation in heuristics
- No recovery/reset events in narrative

**Solutions**:
- Add explicit rest/cleaning scenes
- Tune escalation sensitivity in `state-evolution.ts`
- Add "reset" keywords when appropriate

### Prompts Too Long

**Symptom**: Temporal state sections make prompts exceed token limits
**Solutions**:
- Summarize state (e.g., "3 injuries" instead of listing all)
- Only include changed state properties
- Implement state pruning for old/minor effects

---

## Conclusion

The temporal state tracking system transforms the Cinematic Framework from generating isolated scenes to creating a cohesive, narratively consistent video with realistic progression. By automatically detecting, tracking, and maintaining character and environmental states across scenes, the system ensures that the generated story "feels real" with proper continuity and logical evolution.

**Key Principle**: *Every change persists until the narrative provides a reason for it to revert.*

For questions or enhancements, see:
- [pipeline/types.ts](pipeline/types.ts) - Schema definitions
- [pipeline/agents/state-evolution.ts](pipeline/agents/state-evolution.ts) - Detection logic
- [pipeline/agents/continuity-manager.ts](pipeline/agents/continuity-manager.ts) - Integration point
- [pipeline/prompts/prompt-composer.ts](pipeline/prompts/prompt-composer.ts) - Prompt injection
