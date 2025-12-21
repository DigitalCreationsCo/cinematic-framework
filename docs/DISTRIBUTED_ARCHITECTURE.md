# Distributed Architecture Analysis & Implementation Plan

This document addresses questions regarding distributed system compatibility and outlines a plan to make the Cinematic Video pipeline robust in a multi-worker environment.

## 1. Concepts & Q&A

### Q: Is the Postgres state shared?

**Answer:** Yes.
The PostgreSQL database acts as the **external shared state store**. It is "shared" because multiple independent worker instances (running in different containers, pods, or servers) all connect to the *same* database URL.

* **Mechanism:** When Worker A saves a checkpoint (e.g., "Scene 1 completed"), it writes a row to the `checkpoints` table in Postgres. If Worker A crashes and Worker B starts up, Worker B queries that same table, sees "Scene 1 completed," and resumes from there.
* **Significance:** This is what allows the system to be "distributed" and "fault-tolerant." The state doesn't live in the memory of the Node.js process; it lives in the persistent database.

### Q: What is a distributed lock?

**Answer:** A distributed lock is a mechanism that ensures only **one** worker processes a specific resource (like a specific Project ID) at a time, even when multiple workers are running in parallel.

#### The Architecture

Without a lock, if two workers (Worker A and Worker B) both receive a Pub/Sub message to "Start Project X" (due to a retry or duplicate delivery), they might both try to generate the same video frames simultaneously. This wastes money and corrupts data.

To prevent this, we use a shared "Lock Store" (Postgres, Redis, etc.).

#### The "How" (Implementation)

1. **Acquire:** Before doing any work, Worker A sends a command to the Lock Store: *"I want to lock Project X."*
2. **Check:**
    * If no one has the lock, the Store gives it to Worker A. Worker A proceeds.
    * If Worker B already has the lock, the Store says "Denied." Worker A then skips the task (or waits).
3. **Release:** When Worker A finishes, it tells the Store: *"I'm done with Project X, delete the lock."*
4. **Expiration (Safety):** If Worker A crashes while holding the lock, the lock must have a "Time-To-Live" (TTL) so it expires automatically after X minutes. Otherwise, Project X would be stuck forever.

---

## 2. Compatibility Analysis

We identified three areas where the current `pipeline-worker` relies on **In-Memory (Local) State**, which is incompatible with a distributed architecture.

### 🔴 Critical Issue 1: `activeProjects` Set

* **Location:** `pipeline-worker/index.ts`
* **Current State:** A local JavaScript `Set<string>` tracks which projects are currently running *on this specific machine*.
* **The Problem:** If you run 5 replicas of the worker, each has its own empty `Set`. Worker A won't know that Worker B is already processing Project 123.
* **Fix:** Replace with a **Postgres-based Distributed Lock**.

### 🔴 Critical Issue 2: `latestAttempts` Cache

* **Location:** `pipeline/storage-manager.ts`
* **Current State:** A local JavaScript `Map<string, number>` caches the highest version number (e.g., `scene_001_02.mp4`) seen for each file.
* **The Problem:**
    1. Worker A lists files, sees `v1`, caches `latest=1`.
    2. Worker B lists files, sees `v1`, caches `latest=1`.
    3. Worker A generates `v2`.
    4. Worker B generates `v2` (overwriting A or causing conflict).
* **Fix:** Remove the cache. Always perform a "List Files" operation on GCS to determine the next version number immediately before generation. This adds negligible latency (~100-200ms) compared to generation time (~15s) but ensures correctness.

### 🟡 Minor Issue 3: Local `/tmp` Usage

* **Location:** `pipeline/agents/scene-generator.ts`
* **Current State:** Uses `/tmp` for `ffmpeg` operations (stitching, frame extraction).
* **Analysis:** This is **Safe** for distributed processing, provided:
  * The operations are atomic (download inputs -> process -> upload output -> clean up).
  * No state is expected to persist in `/tmp` between different steps of the LangGraph workflow.
  * **Verification:** The code downloads inputs at the start of functions (like `stitchScenes`) and uploads results at the end. It does not rely on files persisting across function calls.

---

## 3. Implementation Plan

### Step 1: Database Migration

Create a `project_locks` table in Postgres.

```sql
CREATE TABLE IF NOT EXISTS project_locks (
    project_id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL,
    acquired_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
```

### Step 2: Implement `DistributedLockManager`

Create a helper class in `pipeline/utils/lock-manager.ts` to handle:

* `tryAcquire(projectId, workerId, ttlSeconds)`
* `release(projectId, workerId)`
* `refresh(projectId, workerId)` (Heartbeat)

### Step 3: Refactor `pipeline-worker`

* Remove `activeProjects` Set.
* Inject `DistributedLockManager`.
* Wrap command execution in a `tryAcquire` / `release` block.

### Step 4: Refactor `GCPStorageManager` & `GraphState`

* **Modify `GraphState`:** Add `attempts: Record<string, number>` to the shared `GraphState` schema. This persists the attempt counters in Postgres alongside the rest of the workflow state.
* **Update `StorageManager`:**
  * Remove `latestAttempts` in-memory Map.
  * Keep `initialize()` logic but repurpose it to **return** the current state of GCS files (as a `Record<string, number>`) instead of caching it internally. This ensures we can validate or initialize the `GraphState` correctly on startup.
  * Update methods to **require** an explicit attempt number (passed from `GraphState`) instead of relying on an internal cache.
* **Update Graph Initialization:**
  * When starting or resuming a workflow, invoke `StorageManager.scanCurrentAttempts()` (the refactored initialize logic).
  * Merge the scanned attempts with the loaded `GraphState.attempts`. If GCS has a higher version than the DB state (e.g., due to a crash before save), update the state to match GCS to prevent overwrite.
* **Update Agents:** Update `SceneGeneratorAgent` and others to read the current attempt from `GraphState`, increment it for new generations, and return the updated count to be saved in the new state.
