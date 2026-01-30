# Job Retry and Versioning Architecture

This document details the architecture for managing **Asset Versioning** and **System Retries** within the `JobControlPlane`.

## Core Concepts

### 1. Asset Version (User-Facing)
The **Asset Version** represents a distinct generation attempt requested by the user or the workflow logic.
*   Example: "Scene 1, Version 1", "Scene 1, Version 2".
*   This is the logical "attempt" number used in the UI and file storage.

### 2. System Retry (Internal)
A **System Retry** occurs when a job execution fails due to transient errors (e.g., timeouts, crashes) and the worker attempts to execute it again.
*   System retries do **not** increment the Asset Version.
*   They increment the `retry_count` in the database to track execution attempts for that specific version.

## JobControlPlane Implementation

To support both concepts using the single `retry_count` column in Postgres, we use a sliding window approach.

### `createJob` Logic

When a job is created, it accepts a `attempt` which represents the **Asset Version**.

```typescript
// Input
const assetVersion = 5; // User wants Version 5
const allowedSystemRetries = 3;

// JobControlPlane Logic
const job = {
  attempt: assetVersion, // Start at 5
  maxRetries: assetVersion + allowedSystemRetries // Stop at 8
};
```

*   **Initial State**: `retry_count = 5`.
*   **On Failure**: Worker increments `retry_count` to 6.
*   **Retry Condition**: `retry_count (6) < max_retries (8)`. Retry allowed.
*   **On Success**: The result is associated with the job. The `retry_count` might be 6, but the `payload.attempt` (or ID) still reflects Version 5.

### `jobId` Structure

To ensure uniqueness across parallel jobs (e.g., generating 10 scenes at Version 1 simultaneously) and versions, the Job ID follows this pattern:

```text
${projectId}-${node}-${uniqueKey}-${attempt}
```

*   **projectId**: Scope of the project.
*   **node**: Workflow node name (e.g., `process_scene`).
*   **uniqueKey**: (Optional) Unique identifier for batch items (e.g., `sceneId`).
*   **attempt**: The Asset Version.

Example: `myProject-process_scene-scene_123-5`

### Tracking Local Maxima

To determine the next available Asset Version, the `JobControlPlane` provides `getLatestattempt`.

```typescript
const lastAttempt = await jobControlPlane.getLatestattempt(projectId, node, uniqueKey);
const nextVersion = lastAttempt + 1;
```

This queries the `MAX(retry_count)` from the jobs table for the matching pattern, ensuring that new jobs always start after the latest attempt (even if that attempt had multiple system retries).
