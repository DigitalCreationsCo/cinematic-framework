# Core System Architecture

This document outlines the foundational architecture of the Cinematic Canvas generative pipeline. The system is designed as a **distributed, event-driven, and persistent** platform capable of handling complex, long-running generative workflows.

## 1. High-Level Architecture

The system follows a decoupled microservices pattern where the control plane (Client/Server) is separated from the execution plane (Pipeline/Workers). State is authoritative and persistent, ensuring resilience and restartability.

```mermaid
graph TD
    subgraph "Control Plane"
        Client[Frontend Client]
        Server[API Server]
    end

    subgraph "Message Bus (Pub/Sub)"
        Commands[pipeline-commands]
        JobEvents[job-events]
        StatusEvents[pipeline-events]
    end

    subgraph "Execution Plane"
        Pipeline[Pipeline Orchestrator]
        Worker[Generative Workers (Scaled)]
    end

    subgraph "Persistence"
        DB[(PostgreSQL)]
        Storage[Google Cloud Storage]
    end

    Client -->|HTTP| Server
    Server -->|Publish| Commands
    Server -->|SSE| Client
    
    Pipeline -->|Subscribe| Commands
    Pipeline -->|Publish| JobEvents
    Pipeline -->|Read/Write| DB
    
    Worker -->|Subscribe| JobEvents
    Worker -->|Publish| JobEvents
    Worker -->|Read/Write| Storage
    
    StatusEvents -->|Subscribe| Server
    Pipeline -->|Publish| StatusEvents
    Worker -->|Publish| StatusEvents
```

## 2. Core Components

### 2.1. Client & Server (Control Plane)
*   **Client**: A React-based frontend that issues commands and visualizes state. It holds **no authoritative logic** and never infers state; it renders strictly what the server pushes via Server-Sent Events (SSE).
*   **Server**: A stateless message router. It receives HTTP requests, validates them, and publishes commands to Pub/Sub. It also subscribes to status events to forward to connected clients.

### 2.2. Pipeline (Orchestration Layer)
The Pipeline service is the **brain** of the operation but executes no generative work itself.
*   **Responsibilities**:
    *   Hosts the LangGraph workflow execution.
    *   Manages the **Job Plane** (state machine).
    *   Reconciles job events into the authoritative workflow state.
    *   Issues `CREATE_JOB` commands to the workers.
*   **State**: Fully persisted in PostgreSQL. Stateless between restarts.

### 2.3. Workers (Execution Layer)
Workers are the **muscles**. They are stateless, scalable consumers that execute specific generative tasks.
*   **Responsibilities**:
    *   Listen for job assignments via Pub/Sub.
    *   Execute external model calls (LLM, Video Generation, etc.).
    *   Upload assets to Cloud Storage.
    *   Emit `JOB_PROGRESS` and `JOB_COMPLETED` events.
*   **Scaling**: Can be horizontally scaled from 0 to N based on queue depth.

### 2.4. Persistence (Source of Truth)
*   **PostgreSQL**: The single source of truth for Workflow State (Checkpoints) and Job State. All coordination relies on the DB, not in-memory state.
*   **Google Cloud Storage**: Stores large blobs (images, videos, audio) with versioned paths.

## 3. Distributed Coordination

### 3.1. Shared State & Locking
To support multiple active workers and prevent race conditions:
*   **Distributed Locking**: Critical sections (like project initialization) use Postgres-based locks to ensure only one entity modifies specific state at a time.
*   **Idempotency**: All operations are designed to be idempotent. Re-processing a completion event for a finished job is safe and ignored.

Advisory Locks vs. Distributed Lock Manager (DLM)In the graph-based system, choosing the right lock depends on the Duration and Failure Mode of the task.
Feature,Advisory Locks (Transaction-level),Distributed Lock Manager (Table-based)
Best For,"High-Frequency Coordination: Claiming jobs, incrementing counters, preventing double-starts.","Process Governance: Long-running renders (30min+), maintaining ""ownership"" across server restarts."
Cleanup,"Automatic: If the DB connection drops or the process crashes, the lock is instantly released.","TTL/Heartbeat: Requires a ""watcher"" or timeout to release if the worker dies."
Performance,Near-Zero Overhead: Managed in Postgres RAM.,Higher Overhead: Involves disk I/O and table bloat/vacuuming.
Safety,Prevents two workers from starting the same micro-task.,Prevents two different servers from managing the same Project at the same time.

Rule of Thumb: Use Advisory Locks inside your claimJob logic (to ensure exactly-once execution). Use your LockManager table for "Project-level Mutex" (e.g., "Only one worker can edit this Storyboard at a time").

When to avoid PoolManager Transactions
The only time you should not use the PoolManager transaction is for long-polling or Streaming.

If you have a process that waits on a DB notification (LISTEN/NOTIFY) for 5 minutes, it will hold one of your 10 pool connections hostage. For that specific use case, you should create a dedicated, non-pooled connection to avoid "Pool Exhaustion."

Summary Comparison Table
Metric,Drizzle db.transaction,PoolManager transaction
Error Handling,Basic Thro#w/Catch.js,Circuit Breaker Aware
Monitoring,None,Leak Detection & Acquisition Metrics
Concurrency,Blind,Waiting Client Awareness
Suited for claimJob,No,Yes (Recommended)



### 3.2. Versioning & Concurrency
*   **Storage**: Files are not overwritten but versioned (e.g., `scene_001_v2.mp4`). Workers query GCS to determine the next available version number before generation, preventing race conditions where two workers might try to write `v1` simultaneously.

## 4. Job Plane & Workflow

The Job Plane is a transactional layer inside the Pipeline that manages the lifecycle of asynchronous tasks.

### 4.1. Job State Machine
| State | Transitions | Description |
| :--- | :--- | :--- |
| `CREATED` | `RUNNING`, `COMPLETED`, `FAILED` | Job registered in DB, waiting for worker. |
| `RUNNING` | `COMPLETED`, `FAILED`, `CANCELLED` | Worker has picked up the job. |
| `COMPLETED` | *Terminal* | Task finished successfully. |
| `FAILED` | *Terminal* | Task failed after retries. |
| `CANCELLED` | *Terminal* | User or system cancelled the job. |

### 4.2. Fan-Out / Fan-In Pattern
*   **Fan-Out**: When a workflow node needs to perform work (e.g., "Generate 5 Scenes"), it declares **all required jobs upfront**. It emits `CREATE_JOB` commands and records the job IDs.
*   **Fan-In**: The workflow node pauses (checkpoints) and waits. It only advances when `completedJobs ⊇ requiredJobs`.

## 5. Pub/Sub Architecture

Pub/Sub acts as the asynchronous boundary, ensuring decoupling and buffering.

### 5.1. Topics
*   **`pipeline-commands`**: Control signals (`START`, `STOP`, `RETRY`) from Server to Pipeline.
*   **`job-events`**: The workhorse topic.
    *   Pipeline publishes `JOB_DISPATCHED`.
    *   Workers publish `JOB_STARTED`, `JOB_PROGRESS`, `JOB_COMPLETED`, `JOB_FAILED`.
    *   Pipeline subscribes to update state.
*   **`pipeline-events`**: User-facing status updates (`SCENE_GENERATED`, `ERROR`) forwarded to the Client via SSE.
*   **`pipeline-cancellations`**: Broadcast topic to signal all workers to abort specific project tasks immediately.

## 6. Reliability & Retries

### 6.1. Human-in-the-Loop Retries (`retryLlmCall`)
Instead of blind automatic retries, the system uses a controlled retry loop powered by **LangGraph Interrupts**.
*   **Mechanism**: On failure, execution pauses and exposes the error + parameters to the user.
*   **Intervention**: The user (or an agent) can inspect the failure, modify the input parameters (e.g., change the prompt or model), and resume execution.
*   **Safety**: Only explicitly exposed parameters are editable, ensuring the graph state remains valid.

### 6.2. Graceful Cancellation
*   **`STOP_PIPELINE`**: Immediately halts workflow execution and broadcasts cancellation to workers.
*   **Cleanup**: In-progress generation is aborted where possible. The system ensures state is checkpointed so it can be resumed later.

### 6.3. Checkpointing
State is saved to Postgres:
1.  **Before** generation (intent).
2.  **After** job dispatch.
3.  **On** job completion.
This ensures that if any service crashes, the system resumes from the last known good state without data loss.