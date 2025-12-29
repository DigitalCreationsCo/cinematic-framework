# Regenerate Scene Architecture

## Overview

This document outlines the architecture for the "Regenerate Scene" functionality, which allows users to regenerate a scene with an optional modified prompt and **exclude existing frames** (start/end) from the generation process.

## Goals

1. Allow users to view the current enhanced prompt for a scene.
2. Allow users to modify the prompt or provide specific instructions for regeneration.
3. **Allow users to opt-out of using the existing start/end frames** for the regeneration (e.g., if the frames caused issues).
4. Trigger the backend regeneration process with the new parameters.

## Frontend Architecture

### 1. New Component: `RegenerateSceneDialog`

* **Location**: `client/src/components/RegenerateSceneDialog.tsx`
* **Props**:
  * `scene: Scene`
  * `isOpen: boolean`
  * `onOpenChange: (open: boolean) => void`
  * `onSubmit: (params: { prompt: string; excludeStartFrame: boolean; excludeEndFrame: boolean }) => void`
* **Features**:
  * Displays current `enhancedPrompt` in a `Textarea`.
  * Allows editing the text.
  * **Checkboxes**: "Use Start Frame" (checked by default if exists), "Use End Frame" (checked by default if exists).
  * "Cancel" and "Regenerate" buttons.

### 2. Integration: `SceneDetailPanel`

* **Location**: `client/src/components/SceneDetailPanel.tsx`
* **Changes**:
  * Import `RegenerateSceneDialog`.
  * Manage dialog open state.
  * Update `onRegenerate` prop usage to accept the parameters object.
  * New Handler: `handleRegenerateSceneSubmit(params)`.

### 3. State Management: `Dashboard`

* **Location**: `client/src/pages/Dashboard.tsx`
* **Changes**:
  * Update `handleRegenerateScene` function to accept `RegenerateOptions`.
  * Pass `promptModification`, `excludeStartFrame`, `excludeEndFrame` to the `regenerateScene` API call.

## Backend Architecture

### 1. Shared Types

* **File**: `shared/pubsub-types.ts`
  * Update `RegenerateSceneCommand` payload to include `excludeStartFrame?: boolean` and `excludeEndFrame?: boolean`.
* **File**: `shared/pipeline-types.ts`
  * Update `GraphState` to include `sceneFrameExclusions: Record<number, { start?: boolean; end?: boolean; }>;`.

### 2. Pipeline Logic

* **File**: `pipeline/graph.ts`
  * Update `process_scene` node.
  * Retrieve `sceneFrameExclusions` from state.
  * When calling `generateSceneWithQualityCheck`:
    * Check if start frame should be excluded. If so, pass `undefined`.
    * Check if end frame should be excluded. If so, pass `undefined`.

## Data Flow

1. User clicks "Regenerate".
2. Dialog opens. User unchecks "Use Start Frame" and edits prompt.
3. Submit -> `SceneDetailPanel` -> `Dashboard`.
4. `api.regenerateScene({ ..., promptModification: "...", excludeStartFrame: true })`.
5. Backend receives command, updates state: `scenePromptOverrides` and `sceneFrameExclusions`.
6. Workflow runs `process_scene`.
7. `process_scene` sees exclusion flag, ignores `scene.startFrame` when calling generator.
8. Generator produces new video without constraining start frame.

## Implementation Steps

1. **Code Mode**: Update `shared/pubsub-types.ts`.
2. **Code Mode**: Update `shared/pipeline-types.ts`.
3. **Code Mode**: Update `pipeline/graph.ts`.
4. **Code Mode**: Create `RegenerateSceneDialog.tsx`.
5. **Code Mode**: Update `SceneDetailPanel.tsx` (finish tooltips first).
6. **Code Mode**: Update `Dashboard.tsx`.
