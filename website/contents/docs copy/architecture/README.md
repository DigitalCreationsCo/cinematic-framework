# System Architecture

This section documents the technical design and implementation details of the Cinematic Canvas video generation platform.

## Core System
*   [Core System Architecture](core-system.md): High-level overview of the distributed, event-driven pipeline, job plane, and persistence model.

## Subsystems
*   [Data Models & Schemas](data-models.md): Detailed reference of the Type definitions, Schemas, and the DRY composition strategy used for Roles, Scenes, and State.
*   [Prompt Engineering System](prompt-system.md): The Role-Based Prompt Architecture (Director, Cinematographer, etc.) that powers the generative process.
*   [Temporal Tracking System](temporal-system.md): How the system maintains narrative continuity (injuries, weather, time of day) across sequential scenes.
*   [Media Processing](media-processing.md): Architecture of the video rendering and stitching pipeline (`MediaController`).

## Key Patterns
*   **Event-Driven**: All communication between Control Plane and Execution Plane happens via Pub/Sub.
*   **State-Authoritative**: PostgreSQL is the single source of truth; no hidden in-memory state.
*   **Role-Based Generation**: Prompts are composed from specialized "expert" roles rather than monolithic instructions.
*   **Human-in-the-Loop**: Failures trigger interruptible states where humans can intervene (via `retryLlmCall`).

## 🔒 Concurrency Control & Data Integrity

To support high throughput without database deadlocks, we implement a two-layer concurrency strategy.

### 1. Distributed Coordination: Advisory Locks
We do **not** use `SELECT ... FOR UPDATE` (Row Locking) for job coordination. Row locks cause bloating in Postgres and can lead to aggressive vacuuming requirements.

Instead, we use **Postgres Transaction-Level Advisory Locks** (`pg_try_advisory_xact_lock`).
* **Mechanism:** We hash the UUID of the job to a 64-bit integer key.
* **Behavior:** Workers attempt to claim this memory-only lock. If `false` is returned, the worker immediately skips the job (fast-fail).
* **Scope:** Locks are automatically released when the transaction commits or rolls back, preventing "zombie locks" if a worker crashes.

### 2. Data Integrity: Optimistic Locking (Versioning)
To prevent "Lost Updates" (where Worker A overwrites Worker B's results), all entities utilize **Optimistic Concurrency Control**.

* **Schema:** The `jobs` table includes a strictly monotonic `version` integer.
* **Mutation Strategy:** ```sql
    UPDATE jobs 
    SET state = 'COMPLETED', version = version + 1 
    WHERE id = $1 AND version = $read_version
    ```
* **Safety:** If `version` does not match the version read at the start of the transaction, the update affects 0 rows and throws an `OptimisticLockError`.