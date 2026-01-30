# Data Models & Schema Composition

The system uses **Zod** for schema validation and type inference. A key design principle is **Schema Composition** to avoid code duplication (DRY) and ensure consistency across roles.

## Schema Composition Strategy

Instead of defining a massive `Scene` object with 50+ fields, we compose it from smaller, role-specific schemas. This makes the code modular and allows different agents to validate only the subset of data they care about.

### Role Schemas

*   **`DirectorSceneSchema`**: Narrative description, mood, audio sync timing.
*   **`CinematographySchema`**: Shot type, camera angle, movement, focal point.
*   **`ScriptSupervisorSceneSchema`**: Continuity checklists, character tracking, carryforward notes.
*   **`LightingSchema`**: Light quality, color temperature, source motivation.

### The Composite `SceneSchema`

The final `SceneSchema` is an intersection of these role schemas plus generation artifacts:

```typescript
SceneSchema = z.intersection(
  AudioAnalysisAttributesSchema,              // Director: Timing
  z.intersection(
    z.object({ id: number }),      // Core ID
    z.intersection(
      DirectorSceneSchema,         // Director: Narrative
      z.intersection(
        CinematographySchema,      // Cinematographer: Visuals
        z.intersection(
          LightingSchema,          // Gaffer: Lighting
          z.intersection(
            ScriptSupervisorSceneSchema,  // Continuity
            SceneGenerationLegacyAssetsSchema   // Artifacts (Video URLs)
          )
        )
      )
    )
  )
);
```

## Shared Enums

To prevent "magic strings" and ensure type safety, we use shared Zod enums:

*   **`DepartmentEnum`**: `['director', 'cinematographer', 'gaffer', ...]`
*   **`SeverityEnum`**: `['critical', 'major', 'minor']`
*   **`RatingEnum`**: `['PASS', 'FAIL', 'MAJOR_ISSUES', 'MINOR_ISSUES']`

These are used throughout the system for error reporting, quality evaluation, and prompt correction.

## Video Asset References (`string`)

All generated assets are represented as string URLs or string content.

```typescript
  generatedVideo: string; // gs://bucket/path/video.mp4 (Internal/Worker use)
  startFrame: string;  // https://storage.googleapis.com/... (Frontend/Client use)
```

This allows workers to perform efficient internal operations (copy, move, metadata read) using the `gs://` URI. The frontend can directly stream content due to public bucket object permissions.
