# Distributed System Compatibility Report

## Executive Summary
The current implementation of the video generation pipeline contains several state management patterns that prevent safe horizontal scaling and reliable distributed execution. Key issues include in-memory state caching, local file system dependencies with hardcoded paths, and instance-local concurrency controls.

This report details the findings and provides a remediation plan to enable the system to run on multiple worker replicas without race conditions or data corruption.

## Findings

### 1. In-Memory State Caching (`pipeline/storage-manager.ts`)
**Severity: High**
- **Issue**: The `GCPStorageManager` class maintains a local `latestAttempts: Map<string, number>` cache.
- **Mechanism**: On startup, `initialize()` performs a linear scan of GCS files to populate this map.
- **Impact**:
    - **Race Conditions**: In a distributed environment, Worker A increments the attempt count locally. Worker B is unaware of this change and may generate a file with the same attempt number, overwriting data.
    - **Startup Latency**: Scanning GCS becomes increasingly slow as the number of generated assets grows.
    - **Inconsistency**: The source of truth is split between GCS filenames and local memory.

### 2. Local Concurrency Control (`pipeline-worker/index.ts`)
**Severity: Medium**
- **Issue**: The worker uses a local `activeProjects: Set<string>` to prevent duplicate processing of the same project.
- **Impact**:
    - **Ineffective in Distributed Setup**: If multiple worker replicas are running, they do not share this set. A project command could be delivered to multiple workers (e.g., due to Pub/Sub redelivery or lack of strict ordering), leading to double processing.
    - **State Loss on Restart**: If a worker crashes, it loses memory of what it was processing.

### 3. Local File System Conflicts (`pipeline/agents/scene-generator.ts`)
**Severity: High**
- **Issue**: The `SceneGeneratorAgent` uses hardcoded paths in `/tmp` for intermediate file processing (e.g., `/tmp/scene_${sceneId}.mp4`, `/tmp/concat_list.txt`).
- **Impact**:
    - **Data Corruption**: If two jobs (even on the same worker, if concurrency > 1) process the same scene ID or perform stitching simultaneously, they will overwrite each other's temporary files.
    - **Race Conditions**: `concat_list.txt` is a shared filename for all stitching operations.

### 4. Logging Context (`pipeline-worker/index.ts`)
**Severity: Low**
- **Issue**: Uses `AsyncLocalStorage` for `projectIdStore`.
- **Status**: **Acceptable**. This correctly handles request-scoped context within a single Node.js process and is safe for concurrent operations within that process.

## Remediation Plan

### Phase 1: Externalize State (High Priority)
Move the "latest attempt" tracking from the local `GCPStorageManager` cache to the persistent `GraphState` in Postgres.

1.  **Update `GraphState` Schema**:
    - Add a `sceneAttempts` (or similar) field to `GraphState` (map of `sceneId` -> `attemptNumber`) to track the current version of each scene.
    - Alternatively, ensure `metrics.sceneMetrics` is used as the source of truth for the next attempt number.

2.  **Refactor `GCPStorageManager`**:
    - Remove `latestAttempts` Map.
    - Remove `initialize()` GCS scanning logic.
    - Update `getGcsObjectPath` and `resolveAttempt` to require an explicit `attempt` number passed from the caller (which gets it from the state).

3.  **Update Agents**:
    - Modify `SceneGeneratorAgent` and `ContinuityManagerAgent` to read the current attempt number from the `GraphState` passed into them, increment it for new generations, and pass it to `storageManager`.

### Phase 2: File System Safety (High Priority)
Ensure every job execution uses an isolated workspace.

1.  **Unique Temporary Directories**:
    - In `SceneGeneratorAgent` (and any other agent using disk), use `fs.mkdtemp` (or `path.join(os.tmpdir(), uuid)`) to create a unique directory for each operation.
    - Ensure this directory is cleaned up in a `finally` block.
    - Update `extractEndFrameFromVideo` and `stitchScenes` to use these dynamic paths.

### Phase 3: Distributed Concurrency (Medium Priority)
Replace local `activeProjects` with a distributed locking mechanism.

1.  **Distributed Lock**:
    - **Option A (Redis)**: Use a Redis-based lock (e.g., Redlock) for the `projectId`.
    - **Option B (Postgres)**: Use a "leases" table in Postgres. Insert a row with `(projectId, workerId, leaseExpiresAt)` and use a conditional insert/update to acquire the lock.
    - **Option C (LangGraph Checkpointer)**: Rely on the `checkpointer`'s optimistic concurrency. If multiple workers try to update the state, one will fail on version conflict. However, this doesn't prevent them from *running* the expensive generation steps, only from *saving* the result. A lock is preferred to save costs.

## Conclusion
Implementing Phase 1 and 2 is critical for data integrity and basic distributed functionality. Phase 3 optimizes resource usage and prevents redundant work.
