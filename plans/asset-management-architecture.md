# Asset Management Architecture

## Overview

This document outlines the architecture for managing scene assets (start frames, end frames, videos). It enables users to view asset history, delete (exclude) assets, and select previous versions, with low-latency UI updates.

## Goals

1. **History**: Users can view and select from all previously generated versions of a frame or video.
2. **Deletion**: Users can "delete" an asset, which removes it from the active scene state and marks it as excluded/rejected.
3. **Restoration**: Users can select a previous asset to make it active again.
4. **Performance**: UI interactions should be snappy.

## Data Model Changes

### Shared Types (`shared/pipeline-types.ts`)

* **Scene Schema**: Add `rejectedAttempts` to track excluded assets.

    ```typescript
    export interface Scene {
      // ... existing fields
      rejectedAttempts?: {
        startFrame?: number[];
        endFrame?: number[];
        video?: number[];
      };
    }
    ```

## Backend Architecture

### 1. Storage Manager (`pipeline/storage-manager.ts`)

* **New Method**: `listSceneAssets(sceneId: number)`
  * Scans GCS for all files matching `scene_{id}_...`.
  * Returns a list of assets with metadata: `{ type, attempt, url, timestamp }`.

### 2. API Endpoints

* **GET** `/api/video/:projectId/scene/:sceneId/assets`
  * Calls `StorageManager.listSceneAssets`.
  * Returns grouped history (start frames, end frames, videos).
* **POST** `/api/video/:projectId/scene/:sceneId/asset`
  * Body: `{ type: 'startFrame' | 'endFrame' | 'video', attempt: number | null }`
  * **Action**:
    * Updates the `storyboard.json` state for the specific scene.
    * If `attempt` is `null`: Clears the field (e.g., `startFrame = undefined`) and adds the *current* attempt to `rejectedAttempts`.
    * If `attempt` is `number`: Sets the field to the specific GCS URL for that attempt. Removes from `rejectedAttempts` if present.
  * **Response**: Returns updated `Scene` object.

## Frontend Architecture

### 1. New Component: `AssetHistoryPicker`

* **UI**: A popover or modal displaying a grid of thumbnails/videos.
* **Props**: `assets: Asset[]`, `onSelect: (asset) => void`.

### 2. Component Updates: `FramePreview`

* **State**: Fetch history on mount or hover? (Lazy load recommended).
* **Controls**:
  * **Trash Icon**: Calls API to set asset to `null`. Optimistically clears image.
  * **History Icon**: Opens `AssetHistoryPicker`.
  * **Regenerate Icon**: Opens `RegenerateSceneDialog` (with prompt editing).

### 3. Component Updates: `SceneDetailPanel`

* **Video Controls**:
  * Similar controls for the main video player.
  * Overlay or toolbar for Delete/History.

## Workflow Integration

* **Regeneration**:
  * When regenerating, the backend checks `rejectedAttempts`.
  * It ensures the new generation is a *new* attempt (incremented index).
  * (Existing logic already increments attempts, so this is mostly covered, but explicit rejection tracking helps analysis).
* **Deletion**:
  * Deleting the start frame sets `scene.startFrame = undefined`.
  * Subsequent "Regenerate Scene" will run *without* a start frame constraint (as requested).

## Implementation Plan

1. **Code Mode**: Update `shared/pipeline-types.ts`.
2. **Code Mode**: Implement `listSceneAssets` in `StorageManager`.
3. **Code Mode**: Create API endpoints (need to locate server entry point, likely `server/index.ts` or similar).
4. **Code Mode**: Create `AssetHistoryPicker`.
5. **Code Mode**: Update `FramePreview` and `SceneDetailPanel`.
6. **Code Mode**: Finish Tooltips.
