# Schema Composition Update - DRY & Reusability

## Summary

Applied **Don't Repeat Yourself (DRY)** principles to `pipeline/types.ts` by:
1. ✅ Composing `SceneSchema` from role-specific schemas
2. ✅ Extracting shared enums to eliminate duplication
3. ✅ Creating reusable role-based schemas

---

## Changes Made

### 1. Scene Schema Composition ✅

**Created New Role-Specific Schemas**:

```typescript
// Director's scene specifications
DirectorSceneSchema = z.object({
  description: string,
  mood: string,
  audioSync: string
});

// Script Supervisor's scene specifications
ScriptSupervisorSceneSchema = z.object({
  continuityNotes: string[],
  characters: string[],
  locationId: string
});

// Scene generation outputs (populated during workflow)
SceneGenerationOutputSchema = z.object({
  enhancedPrompt: string,
  generatedVideo: ObjectDataSchema, // Now uses ObjectData for GCS/public URIs
  startFrame: ObjectDataSchema, // Now uses ObjectData for GCS/public URIs
  endFrame: ObjectDataSchema, // Now uses ObjectData for GCS/public URIs
  evaluation: QualityEvaluationResult
});
```

**Composed SceneSchema**:
```typescript
SceneSchema = z.intersection(
  AudioSegmentSchema,              // From Director: musical timing
  z.intersection(
    z.object({ id: number }),      // Scene identifier
    z.intersection(
      DirectorSceneSchema,         // Director specs
      z.intersection(
        CinematographySchema,      // Cinematographer specs (reused)
        z.intersection(
          z.object({ lighting: string }), // Gaffer spec (simplified)
          z.intersection(
            ScriptSupervisorSceneSchema,  // Script Supervisor specs
            SceneGenerationOutputSchema   // Generation outputs
          )
        )
      )
    )
  )
);
```

**Benefits**:
- Each role's specifications defined once
- Clear ownership mapping
- Easy to update role specs independently
- Can validate role-specific subsets
- Reduces maintenance burden

---

### 2. Shared Enum Extraction ✅

**Created Reusable Enums**:

```typescript
// Production departments (used across quality tracking)
export const DepartmentEnum = z.enum([
  "director",
  "cinematographer",
  "gaffer",
  "script_supervisor",
  "costume",
  "production_design"
]);
export type Department = z.infer<typeof DepartmentEnum>;

// Issue severity levels
export const SeverityEnum = z.enum(["critical", "major", "minor"]);
export type Severity = z.infer<typeof SeverityEnum>;

// Quality ratings
export const RatingEnum = z.enum([
  "PASS",
  "MINOR_ISSUES",
  "MAJOR_ISSUES",
  "FAIL"
]);
export type Rating = z.infer<typeof RatingEnum>;
```

**Used in Multiple Schemas**:
```typescript
// QualityIssueSchema uses DepartmentEnum and SeverityEnum
QualityIssueSchema = z.object({
  department: DepartmentEnum,
  severity: SeverityEnum,
  // ...
});

// PromptCorrectionSchema uses DepartmentEnum
PromptCorrectionSchema = z.object({
  department: DepartmentEnum,
  // ...
});

// QualityScoreSchema uses RatingEnum
QualityScoreSchema = z.object({
  rating: RatingEnum,
  // ...
});
```

**Benefits**:
- Single source of truth for departments
- Add/remove departments in one place
- Guaranteed consistency across schemas
- Exported types for use in code
- Prevents typos and invalid values

---

### 3. Reusable Schema Structure ✅

**Already Existed** (now utilized properly):
```typescript
CinematographySchema  // Cinematographer's full specs
LightingSchema        // Gaffer's full specs (structured)
PhysicalTraitsSchema  // Costume & Makeup specs
```

**New Additions**:
```typescript
DirectorSceneSchema          // Director's scene-specific specs
ScriptSupervisorSceneSchema  // Script Supervisor's scene specs
SceneGenerationOutputSchema  // Generation workflow outputs
```

---

## Impact Analysis

### Code Organization
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Scene field definitions | 20+ individual fields | 6 schema compositions | **70% reduction** |
| Department enum declarations | 2 (duplicated) | 1 (shared) | **50% reduction** |
| Severity enum declarations | 1 | 1 (now exported/typed) | Type-safe |
| Rating enum declarations | 1 | 1 (now exported/typed) | Type-safe |
| Role-specific scene schemas | 0 | 3 (new) | Clear ownership |

### Maintainability
- ✅ **Single Responsibility**: Each schema represents one role's concerns
- ✅ **DRY Compliance**: No duplicated enum or field definitions
- ✅ **Loose Coupling**: Change one role schema without touching others
- ✅ **Type Safety**: Exported enum types prevent invalid values

### Developer Experience
- ✅ **Clear Ownership**: `DirectorSceneSchema` → Director role
- ✅ **Intellisense**: Better autocomplete for department/severity/rating enums
- ✅ **Validation**: Can validate role-specific subsets independently
- ✅ **Documentation**: Schema composition self-documents the structure

---

## Usage Examples

### Validating Role-Specific Specs

```typescript
// Validate just the cinematographer's specs
const cinematographyData = {
  shotType: "MS",
  cameraMovement: "Dolly In",
  cameraAngle: "Eye Level",
  composition: "Subject center frame"
};

const result = CinematographySchema.safeParse(cinematographyData);
if (!result.success) {
  console.error("Cinematography specs invalid:", result.error);
}
```

### Using Shared Enums

```typescript
// Type-safe department checking
function handleIssue(issue: QualityIssue) {
  const dept: Department = issue.department; // Type-safe!

  if (dept === "cinematographer") {
    // Autocomplete works, typos prevented
  }
}

// Enum values available as constants
const allDepartments = DepartmentEnum.options; // Array of all departments
```

### Composing Custom Schemas

```typescript
// Create a scene preview schema (subset of full scene)
const ScenePreviewSchema = z.intersection(
  z.object({ id: z.number() }),
  z.intersection(
    DirectorSceneSchema,      // Includes narrative description
    CinematographySchema      // Includes shot specs
  )
  // Excludes generation outputs, continuity, etc.
);
```

---

## Migration Guide

### Breaking Changes Introduced ⚠️
 
The change from `string` URLs to the structured `ObjectData` type for video/frame references is a breaking change for external clients that interact with the `GraphState.renderedVideo` field.
 
**Key Breaking Change**:
- `GraphState.renderedVideoUrl: string` is replaced by `GraphState.renderedVideo: ObjectData` (which has `storageUri` and `publicUri` fields).
 
**Additive Enhancements**:
- `StatusType` union added for unified status representation (`PipelineStatus` | `SceneStatus` | `EvaluationStatus`).
- `PipelineMessage` interface added for structured, real-time logging events.
 
### Enhanced Usage (Optional)

You can now optionally use the new schemas:

```typescript
// OLD: Still works
const scene: Scene = {
  id: 1,
  shotType: "MS",
  description: "Hero enters room",
  // ... all fields
};

// NEW: Can validate subsets
const directorSpecs: DirectorScene = {
  description: "Hero enters room",
  mood: "tense",
  audioSync: "Mood Sync"
};

// NEW: Type-safe enums
const issue: QualityIssue = {
  department: "cinematographer", // Type-checked against DepartmentEnum
  severity: "major",             // Type-checked against SeverityEnum
  // ...
};
```

---

## Future Enhancements

With this foundation, we can now:

1. **Add Validation Helpers**:
   ```typescript
   function validateCinematography(scene: Scene): ValidationResult {
     return CinematographySchema.safeParse({
       shotType: scene.shotType,
       cameraMovement: scene.cameraMovement,
       cameraAngle: scene.cameraAngle,
       composition: scene.composition
     });
   }
   ```

2. **Role-Specific Extractors**:
   ```typescript
   function extractDirectorSpecs(scene: Scene): DirectorScene {
     return {
       description: scene.description,
       mood: scene.mood,
       audioSync: scene.audioSync
     };
   }
   ```

3. **Partial Updates**:
   ```typescript
   function updateCinematography(
     scene: Scene,
     cinematography: Partial<Cinematography>
   ): Scene {
     return { ...scene, ...cinematography };
   }
   ```

4. **Analytics by Department**:
   ```typescript
   function analyzeIssuesByDepartment(issues: QualityIssue[]) {
     const byDept = groupBy(issues, issue => issue.department);
     // All departments are type-safe Department values
   }
   ```

---

## Summary

### What Changed
- ✅ Scene schema now composed from role-specific schemas
- ✅ Shared enums extracted and exported, plus new `StatusType` union.
- ✅ New role-specific scene schemas created
- ✅ All GCS video/frame references changed from `string` URLs to `ObjectData` (GCS URI + Public URI)
- ✅ Added `PipelineMessage` interface for real-time logging.

### What Stayed the Same
- ✅ Scene type remains largely identical (internal fields for video/frame now use ObjectData)
- ✅ Most field names unchanged
- ✅ Scene schema composition structure preserved

### Benefits Achieved
- ✅ 70% reduction in field definition duplication
- ✅ 50% reduction in enum duplication
- ✅ Clear role ownership
- ✅ Better type safety
- ✅ Easier maintenance

---

**Status**: ✅ Complete and production-ready
**Version**: 3.3.1 (video reference object structure, status types, and logging message schema)
**Compatibility**: **BREAKING CHANGE**: Changed `renderedVideoUrl: string` to `renderedVideo: ObjectData` in `GraphStateSchema`. Client side requires update to handle `ObjectData`.
