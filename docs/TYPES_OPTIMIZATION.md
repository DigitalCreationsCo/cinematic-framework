# Types Schema Optimization - First AD's Report

## 🎭 First AD's Organizational Decisions

As the **First Assistant Director**, I've reorganized schemas in `shared/pipeline-types.ts` to align with our role-based prompt architecture, incorporate required tracking data, and ensure robust integration with the persistent state layer.

---

## Key Optimizations Applied

### 🎯 Schema Composition & DRY Principles

The schemas are now heavily composed using shared enums and role-specific object schemas to minimize redundancy.

#### Shared Enums (DRY Improvement)

Centralized enums ensure consistency across validation layers:

```typescript
// Shared definitions in shared/schema.ts (or similar location)
export const DepartmentEnum = z.enum([
  "director", "cinematographer", "gaffer",
  "script_supervisor", "costume", "production_design", "quality_control" // Added QC role
]);
export const SeverityEnum = z.enum(["critical", "major", "minor"]);
export const RatingEnum = z.enum(["PASS", "MINOR_ISSUES", "MAJOR_ISSUES", "FAIL"]);
```

#### Scene Schema Composition

The `SceneSchema` is now a composition reflecting inputs from multiple roles and persistent outputs:

```typescript
// Simplified Composition Structure
SceneSchema = z.intersection(
  AudioSegmentSchema, // From AudioProcessingAgent
  z.intersection(
    z.object({ id: number }),
    z.intersection(
      DirectorSceneSchema, // Narrative intent
      z.intersection(
        CinematographySchema, // Shot specs
        z.intersection(
          LightingSchema, // Gaffer specs
          z.intersection(
            ScriptSupervisorSceneSchema, // Continuity requirements
            SceneGenerationOutputSchema // Generation results (video, frames, evaluation)
          )
        )
      )
    )
  )
);
```

---

## Schema Updates Reflecting New Requirements

### 1. Location Schema Update (Gaffer/Production Designer Integration)

The lighting specification, previously a simple string, is now a detailed object to allow for more precise prompting and evaluation.

**Old Location Schema (Implied):**
```typescript
lightingConditions: string; // e.g., "Dramatic backlight with golden rays"
```

**New `LocationSchema` (Production Designer Owned):**
```typescript
interface LightingConditions {
  quality: string; // e.g., "Dappled sunlight"
  colorTemperature: string; // e.g., "5500K"
  intensity: string; // e.g., "medium"
  motivatedSources: string; // e.g., "sunlight"
  direction: string; // e.g., "Front-frame"
}

LocationSchema = z.object({
  // ... existing fields
  lightingConditions: LightingSchema, // NEW: Detailed lighting structure
  weather: string, // NEW: Explicit weather condition
  colorPalette: string[], // NEW: Primary colors for continuity
  naturalElements: string[], // NEW
  manMadeObjects: string[], // NEW
  referenceImages: z.array(ImageReferenceSchema).optional(),
  // ...
});
```
**Benefit**: Allows the **Gaffer** role to provide precise lighting instructions and the **QualityControlSupervisor** to evaluate lighting components individually.

### 2. Scene Schema Additions (Audio & Continuity)

New fields added to track explicit scene data:

```typescript
SceneSchema = z.object({
  // ... existing fields
  musicalDescription: string.optional(), // NEW: From AudioProcessingAgent for context if no lyrics
  type: string,
  lyrics: string.optional(),
  transitionType: string,
  // ...
  // Temporal State is tracked in CharacterStateSchema and LocationStateSchema, 
  // not directly on Scene except for the final evaluation object.
  // ...
});
```
**Benefit**: Provides richer context directly on the scene object, useful for debugging and high-level visualization.

### 3. Character Schema Enhancements (Costume/Makeup & Script Supervisor)

Character definitions are now richer to support better temporal state tracking and reference validation.

```typescript
PhysicalTraitsSchema = { // Costume & Makeup Dept Ownership (Baseline Specification)
  hair: string,
  clothing: string | string[], // Flexible: single string or array
  accessories: string[].default([]),
  distinctiveFeatures: string[].default([]),
  build: string.optional(),      // NEW
  ethnicity: string.optional()   // NEW
};

CharacterStateSchema = { // Script Supervisor Ownership (Mutable State)
  lastSeen: number,
  position: string,
  emotionalState: string,
  physicalCondition: string // Accumulated damage/dirt/exhaustion
};
```
**Benefit**: Clearly separates the *immutable specification* (PhysicalTraits, owned by Costume/Makeup) from the *mutable, temporal state* (CharacterState, owned by Script Supervisor and persisted across frames/scenes).

### 4. Workflow Metadata Update

The main workflow metadata object is updated to track models used, which is crucial for performance analysis and rollback scenarios.

```typescript
VideoMetadataSchema = {
  // ... existing fields
  videoModel: string.optional(), // NEW
  imageModel: string.optional(), // NEW
  textModel: string.optional(),  // NEW
  creativePrompt: string.optional() // NEW: Preserves the initial trigger prompt
}
```

---

## Data Persistence and Schema Integration

The **PostgreSQL Checkpointer** system stores the entire `GraphState`, which includes all the optimized scene, character, and location schemas.

**Impact on Roles**:
- **Script Supervisor**: Relies on `CharacterStateSchema` and `LocationStateSchema` being correctly updated in the persistent state after scene processing.
- **Continuity Agent**: Ensures `referenceImages` fields on Character/Location objects are populated, which are then validated against image quality metrics before use.

---

## Version History & Status

- **v3.1.0**: Schema structure updated to support role-based prompting fields (e.g., dedicated LightingSchema, CompositionSchema) and temporal state tracking.
- **v3.2.0 (Current)**: Schema updated to include detailed `lightingConditions` object for Location, enhanced Character demographics, and model tracking metadata.

**Status**: ✅ Complete. The schemas now fully support the requirements of the role-based prompt architecture and the new persistent, command-driven workflow.
