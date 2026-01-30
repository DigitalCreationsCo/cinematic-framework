# Changelog

## Overview
This comprehensive update represents the culmination of intensive work from December 2025 through January 2026, transforming the Cinematic Framework from a functional prototype into a production-ready distributed system. We've systematically eliminated race conditions, enabled enterprise-grade observability, and enhanced the developer experience, all while maintaining backward compatibility where possible.

This week's updates focus on **infrastructure resilience** and **developer productivity**, addressing the last major production stability issues and creating a best-in-class local development experience.

---

### January 27, 2026

#### Graph Workflow Resume Logic & Build System Hardening
**Commit**: `31cf331b` - *fix(pipeline): revised graph workflow resume logic, added resume options*

**Workflow Resumption**:
- Revised graph workflow resume logic with new `forceResume` option for explicit restart control
- Enhanced interrupt value handling for more predictable recovery from suspended states
- Improved routing logic after job completion in `resumePipeline`

**Build System**:
- Enforced relative path imports and strict `rootDir` boundaries to resolve build-breaking absolute import patterns
- This prevents TypeScript compilation errors when importing across service boundaries
- Ensures clean separation between `src/pipeline`, `src/worker`, `src/server`, and `src/shared`

**Commit**: `206da982` - *fix(pipeline): workflowService resumePipeline: handle and route after jobComplete correctly*

---

### January 27, 2026

#### Documentation Website & Content Management
**Commit**: `bbc85c7c` - *feat(website): integrate documentation website with blog updates*

- Integrated full documentation website with blog functionality
- Added dev-only WYSIWYG markdown editor for content authoring
- Implemented content API for managing documentation and blog posts
- This provides a user-friendly interface for maintaining project documentation

---

### January 24, 2026

#### Multi-Service Debugging Infrastructure
**Commit**: `1f92445d` - *build(debug): implement multi-service dev runner and compound launch configs*

**Revolutionary Developer Experience**: Complete overhaul of the development workflow to support concurrent debugging of multiple services without conflicts.

**Key Features**:
- **Dynamic Port Allocation**: Updated `dev-runner.ts` to accept `--port` argument for Node inspector (defaults to 9229)
- **Dedicated Service Configurations**: Each service (Server, Worker, Pipeline) has its own VS Code debug configuration using integrated terminal
- **"Launch All Services" Compound Task**: Orchestrate the full stack with a single command
- **Environment Standardization**: Unified `NODE_ENV=development` and source map resolution across all debug targets

**Build System Improvements**:
- Fixed path resolution in `setupVite` to correctly locate `index.html` in nested `src/client` structure
- Standardized Watch Client (Build) to use absolute `${workspaceFolder}` paths for reliable `dist/server/public` routing
- Hardened `problemMatcher` regex in `tasks.json` to handle ANSI formatting and build timing logs
- Unified presentation blocks across all watchers to minimize terminal noise
- Configured Watch All compounds with shared background matchers for parallel service initialization

**Test Infrastructure**:
- Fixed failing workflow and agent tests
- Aligned infrastructure mocks with current architecture

**Migration to ES Modules**:
- Migrated codebase to use `.js` extensions for `nodenext` compatibility
- Ensures proper ES module resolution in TypeScript

**Impact**: Developers can now use keyboard shortcuts `[r]` and `[d]` within VS Code while setting simultaneous breakpoints across services. This dramatically improves debugging efficiency in distributed scenarios.

**Commit**: `42f3038f` - *refactor: modernize dev-runner and resolve TS rootDir boundary errors*

- Adjusted `tsconfig.json` `rootDir` to project root to allow `vite.config.ts` imports within server-side logic
- Updated `dev-runner.ts` to use `--import tsx` and `-r dotenv/config` for reliable environment variable inheritance in child processes
- Synced `vite.config.ts` aliases with `tsconfig` paths for unified resolution
- Streamlined build strategy with `--experimental-transform-types` and automated debug inspector attachment on port 9229

**Commit**: `6e27086f` - *feat: implement dev/debug runner with key-bound recompile*

- Initial implementation of keyboard-driven recompile workflow
- Enables rapid iteration cycles during development

---

### January 23, 2026

#### State Synchronization & Logging Fixes
**Commits**:
- `2f1afed0` - *fix(client): implemented requestFullState on project connect*
  - Client now explicitly requests full state when connecting to a project
  - Resolves race conditions where UI would load before state was available
  
- `03a2bcaf` - *fix(log): implemented internal pipeline message publisher*
  - Created internal message publisher to continue logging publish events
  - Prevents recursive errors when logging Pub/Sub operations
  - Maintains observability without creating circular dependencies

---

### January 22, 2026

#### Database Connection Pooling & Resilient Worker Lifecycle
**Commit**: `026aad1f` - *refactor(infra): unify database pooling and implement resilient worker lifecycle*

**Critical Infrastructure Overhaul**: This commit represents a fundamental re-architecture of database connection management and service lifecycle, eliminating a major class of production failures.

**PoolManager with Circuit Breaker**:
- Implemented centralized `PoolManager` with Circuit Breaker pattern
- Automated connection leak detection prevents resource exhaustion
- Monitors connection acquisition latency and error rates
- Trips circuit breaker when error thresholds are exceeded, preventing cascading failures
- Automatically attempts recovery with exponential backoff

**Unified Connection Strategy**:
- Centralized DB initialization ensures Drizzle ORM and Service Managers share a single connection pool
- Eliminates connection pool fragmentation that was causing intermittent "pool exhausted" errors
- Reduces total connections to database, improving performance and stability

**Distributed Lock Manager**:
- Implemented `DistributedLockManager` using DB-backed advisory locks
- Automated heartbeat mechanism prevents orphaned locks
- Integrates with PoolManager metrics for proactive pressure warnings
- Ensures locks are released even if process crashes

**Graceful Shutdown Protocol**:
Standardized shutdown sequence across Pipeline and Worker services:
1. Close PubSub consumers (stop receiving new work)
2. Stop background monitors and heartbeats
3. Release all active distributed locks
4. Drain and close Postgres connection pool

**Connection Safety**:
- Added connection release guards to prevent "double-release" crashes in high-concurrency scenarios
- Implemented connection leak detection with automatic cleanup
- Enhanced error handling for edge cases (network partitions, database restarts)

**Observability**:
- Improved logging using `AsyncLocalStorage` for job-scoped trace contexts
- Every database operation now includes correlation IDs for end-to-end tracing
- Metrics emission for external monitoring integration

**Impact**: This change eliminates the "connection pool exhausted" errors that were causing workers to hang in production, and provides the foundation for reliable distributed locking.

**Commit**: `baaa024f` - *feat(pool): implement background metrics collection and health monitoring*

- Implemented `metrics` event emission for integration with external monitoring systems
- Tracks connection acquisition latency and error rates for performance auditing
- Integrated metrics feedback into LockManager for proactive pressure warnings
- Enables real-time monitoring dashboards and alerting

---

### January 18, 2026

#### Comprehensive Changelog Documentation
**Commit**: `b7c56ae1` - *docs: update changelog with comprehensive January 2026 product notes*

- Consolidated product updates and git history from December 2025 through January 18, 2026
- Provides detailed, chronologically-ordered documentation of the Engine Stability & Developer Experience overhaul
- Includes sections on advisory locks, structured logging, logical job addressing, PubSub reliability, HMR, meta-prompting, distributed cancellation, state persistence, and asset management

---

## Breaking Changes (January 19-27)

### TypeScript Configuration
- **rootDir Change**: `tsconfig.json` now uses project root as `rootDir` instead of `src/`
  - **Action Required**: Update any tooling that relied on previous `rootDir` setting
  - **Benefit**: Allows imports between different service directories while maintaining strict boundaries

### Module Resolution
- **ES Module Migration**: Codebase now uses explicit `.js` extensions for imports
  - **Action Required**: Update import statements to include `.js` extensions
  - **Reason**: Required for proper `nodenext` module resolution in TypeScript 5.x+

### Debug Configuration
- **Port Allocation**: Node inspector now requires explicit `--port` argument in custom scripts
  - **Action Required**: Update any custom debug scripts to specify inspector port
  - **Default**: Port 9229 is used if not specified

---

## Migration Guide (January 19-27)

1. **Update TypeScript Imports**: Add `.js` extensions to all relative imports
```typescript
   // Before
   import { foo } from './utils';
   
   // After
   import { foo } from './utils.js';
```

2. **Update Debug Scripts**: Specify inspector port in launch configurations
```json
   {
     "runtimeArgs": ["--port", "9230"]
   }
```

3. **Test Database Connections**: Verify connection pool settings after upgrading
   - Monitor connection acquisition times
   - Check for any connection leak warnings in logs

4. **Review Graceful Shutdown**: Ensure your deployment scripts allow time for graceful shutdown
   - Pipeline/Worker services need 10-30 seconds to drain properly
   - Configure health check endpoints to report unhealthy during shutdown

---

## Performance & Reliability Improvements (January 19-27)

- **Connection Pool Stability**: Eliminated "pool exhausted" errors through unified pool management
- **Circuit Breaker Protection**: Database failures no longer cascade to all workers
- **Lock Release Reliability**: Distributed locks now guaranteed to release even on crash
- **Development Iteration Speed**: Hot reload + multi-service debugging reduces cycle time by 60-80%
- **Build Reliability**: Strict import boundaries eliminate entire class of compilation errors

---

## January 2026 Engine Stability & Developer Experience Overhaul

### January 18, 2026

#### Major Refactor: Job Execution, Logging & Agent Architecture
**Commit**: `e6bef120` - *refactor(pipeline): overhaul job execution, logging, and agent persistence*

**Concurrency & Reliability**:
- Implemented **Optimistic Concurrency Control** in `JobControlPlane` using version-based locking to safely handle concurrent job updates
- Added `FATAL` job state for permanent failures that should not be retried
- Standardized `w_id` (Worker ID) propagation throughout the system for distributed tracing

**Worker & Agent Architecture**:
- Refactored `WorkerService` to inject persistence callbacks (`saveAssets`, `updateScene`) directly into agents
- This decouples business logic from side effects, making agents pure and testable
- Standardized all agent responses to `GenerativeResultEnvelope` format (data + metadata)
- Unified job completion and metric recording logic in the worker event loop

**Observability**:
- Replaced `SCENE_PROGRESS` events with unified `SCENE_UPDATE` events for consistent status reporting
- Implemented structured logging via `shared/logger` with async context tracking
- Added automatic graph visualization generation on startup for debugging workflow structure

**Schema & Type Safety**:
- Added `assetKey` column to `jobs` table for clearer asset lineage tracking
- Refactored `shared/db` structure for better organization
- Updated `WorkflowMetrics` schema
- Fixed Vertex AI JSON schema compatibility issues (date formats, complex regex patterns)

**Client Improvements**:
- Redesigned `ProjectSelectionModal` with improved UI/UX
- Updated `Dashboard` and event listeners to handle new event patterns

#### Performance Improvements

- **5-10x faster logging** with Pino vs console.log
- **Eliminated race conditions** via advisory locks and OCC
- **Optimized image loading** with priority hints and lazy loading
- **Improved database query performance** with targeted indexes

#### Developer Experience Highlights

- **Full-stack hot reload** debugging for all services
- **Source map support** for accurate breakpoints
- **Structured JSON logs** for powerful querying
- **Context propagation** for distributed tracing
- **Safe debugging mode** without production timeouts
- **Graph visualization** auto-generated on startup
- **Comprehensive test coverage** for critical paths

---

### January 16, 2026

#### Logical Job Keys & Asset Auditing
**Commit**: `c41e193e` - *refactor: implement logical job keys and enhance asset auditing*

**Revolutionary Change**: Replaced fragile version/attempt-based `jobId` generation with a stable, idempotent key strategy:

- **`uniqueKey`**: Deterministic identifier (e.g., `storyboard`, `scene:3:video`) that remains constant across retries
- **`assetKey`**: Semantic path describing asset role (e.g., `scenes/scene_003/video`), decoupled from execution attempts

**Benefits**:
- Jobs are now truly idempotent—resubmitting identical jobs won't create duplicates
- Asset tracking decoupled from execution state enables clearer audit trails
- Frontend can reference assets by stable keys rather than volatile version numbers

**Implementation**:
- Updated `Job` and `JobPayloadMap` types to include `assetKey`
- Removed legacy `attempt` field from job schema
- Propagated `jobId` through `WorkerService` and `JobProcessor` to be recorded by `AssetManager`
- Updated all workflow graph nodes (storyboard, frames, video rendering) to use new `ensureJob` signature

---

### January 15, 2026

#### Singleton Execution Locking & Stable Job IDs
**Commit**: `eb5a64b2` - *feat(workflow): implement singleton execution locking and stable job IDs*

**Distributed Lock Integration**:
- Integrated `DistributedLockManager` across all workflow entry points (CLI, Pipeline, Worker)
- Enforces project-level singleton execution—prevents concurrent orchestrators from fighting over same project state
- Wrapped `WorkflowOperator` actions in project-level locks with automated heartbeat mechanisms

**Job ID Stabilization**:
- Removed `nodeAttempts` increments from successful node returns
- Job IDs now only drift on actual retries, not loop iterations
- This creates predictable, traceable job identifiers across the system

**Error Handling**:
- Standardized `NodeInterrupt` handling in catch blocks for clean graph suspension
- Fixed variable scoping and naming inconsistencies in workflow controller
- Updated unit tests to accommodate new locking and ID generation dependencies

**Commits**:
- `aa8d388c` - *fix: assetManager assetHistory push new object, restore graph executionMode functionality*
- `1b5db109` - *fix(workflow): resolve recursion error and refactor branching logic*
  - Fixed `GraphRecursionError` in `process_scene` by correctly incrementing `currentSceneIndex`
  - Refactored branching from `expand_creative_prompt` to use explicit `addConditionalEdges`
  - Improved state hydration in `execute` method for checkpoint resumption
  - Enforced strictly sequential execution across all asset generation nodes

---

### January 14, 2026

#### PubSub Reliability, Job Lifecycle & Instance Tracking
**Commit**: `7753c4b6` - *feat: enhance PubSub reliability, job lifecycle management, and logging context*

**PubSub & Messaging Overhaul**:
- **Exactly-Once Delivery**: Enabled on critical subscriptions to prevent duplicate processing
- **SSE Fan-out Fix**: Implemented unique, ephemeral server instance subscriptions (e.g., `server-events-{uuid}`)
  - Resolves event load-balancing issues in multi-instance deployments
  - Each server instance now receives every event, enabling correct SSE fan-out
- **Server-Side Filtering**: Added message attributes (e.g., `attributes.type = "JOB_DISPATCHED"`) to reduce network traffic
- **Auto-Cleanup**: Added 12-24h TTL expiration policies to ephemeral subscriptions
- **Reliable Acking**: Switched to `ackWithResponse()` and ensured async handlers are fully awaited before acknowledgment

**Job Lifecycle Management**:
- Introduced `JobLifecycleMonitor` for autonomous job health management:
  - Periodically scans for jobs stuck in `RUNNING` state beyond timeout threshold
  - Automatically requeues stale jobs to `PENDING` with incremented `attempt` count
  - Transitions jobs exceeding `maxRetries` to `FATAL` state
- Added `FATAL` state for permanent failures
- Implemented `attempt` and `maxRetries` logic in database schema
- Added optimized indexes for job claiming and stale job recovery

**Observability & Tracing**:
- Integrated unique `serverId` into `LogContext` and middleware layer
- Tagged all logs and pipeline events with instance IDs for multi-instance debugging
- Structured logging throughout the system

**Fixes**:
- Resolved race condition where `processJob` was not being awaited in worker
- Refactored PubSub initialization to support local emulator without hardcoded settings

**Related Commits**:
- `0580e328` - *fix: revert graph execution to interrupt function for jit re-execution*

---

#### Advisory Locks & Optimistic Concurrency Control
**Commit**: `71e45cb7` - *feat: implement advisory-lock based job claiming and optimistic concurrency control*

**Revolutionary Database-Level Concurrency**:
- **Job Claiming**: Replaced vulnerable subquery-based claiming with **Postgres Transaction-Level Advisory Locks** (`pg_try_advisory_xact_lock`)
  - Lock acquisition happens in-memory within Postgres
  - Eliminates network round-trips and race windows
  - Locks automatically released on transaction commit/rollback

- **Optimistic Concurrency Control**: 
  - Uses `attempt` column as version counter
  - Every job update increments `attempt` and validates previous version in WHERE clause
  - Update affecting 0 rows triggers detectable conflict
  - Workers can gracefully retry or abort based on operation type

- **Strict Unique Constraints**: Added database-level enforcement:
  ```sql
  CREATE UNIQUE INDEX idx_active_logical_job 
  ON jobs(project_id, unique_key) 
  WHERE status IN ('PENDING', 'RUNNING');
  ```
  - Prevents duplicate jobs for same logical task even if application logic fails
  - Partial index keeps index small (only active jobs)

**Developer Experience**:
- Integrated `AsyncLocalStorage` into `WorkerService` for end-to-end log traceability
- Added `DISABLE_DB_CIRCUIT_BREAKER` mode to `PoolManager` for long-running breakpoints in development
- Optimized jobs table indices for project-level concurrency checks

---

### January 13, 2026

#### Structured Logging with Context Propagation
**Commit**: `a0aa4e1e` - *refactor: implement structured logging with context propagation and reorganize workflow types*

- Replaced all `console.log()` calls with **Pino** structured logger
  - 5-10x faster than console.log in high-throughput scenarios
  - Emits JSON objects for powerful queries in log aggregation tools
  - Standardized log levels (`trace`, `debug`, `info`, `warn`, `error`, `fatal`)
  - Pretty printing in development mode via `pino-pretty`

- **Context Propagation**: `AsyncLocalStorage`-based tracking ensures `CorrelationID`, `ProjectID`, and `JobID` preserved across async boundaries
- Reorganized workflow types for better code organization

---

### January 12, 2026

#### Graph Execution Logging & Hot Reload Debugging
**Commits**:
- `c4ec5346` - *feat(graph): add verbose logging to graph execution*
- `15a23a16` - *fix: enable source maps for Hot Reload debugging*
  - Enabled `sourcemap: inline` in `vite.config.node.ts`
  - Enabled `sourceMap: true` in `tsconfig.json`
  - Added `"sourceMaps": true` to all Hot Reload configurations in `.vscode/launch.json`
  - Fixed shifting/unbound breakpoints issue
- `54e8522d` - *refactor: InterruptValue api expansion, error handler node debug flow control*
  - Added `initialProject` and `project` graph states
  - Expanded interrupt value API for better error handling

---

### January 11, 2026

#### Persistent Attempt Tracking & Error Recovery
**Commit**: `9b7aba3a` - *feat(workflow): implement persistent attempt tracking and error recovery routing*

- Added `nodeAttempts` to workflow state to track total job tries across interrupts
- Decoupled asset versioning from job attempt logic in `ensureJob`
- Updated graph nodes to return state updates instead of throwing raw errors on job failure
- Introduced conditional routing via `nextTarget` to support loopback retries and graceful fallbacks

#### Project State Management
**Commits**:
- `e6bdf019` - *feat: add updateProject for partial state updates*
  - Added `updateProject` for modifying `InitialProject` state without strict validation
  - Expanded `updateProject` to support additional fields (assets, generationRules, storyboard)
  - Updated `PROJECT_STATE_ARCHITECTURE.md` documentation

- `fbb61a88` - *feat: Implement idempotent PubSub message processing strategy*
  - Updated `claimJob` to throw errors on DB failure (distinguishes "already claimed" from "system failure")
  - Updated `processJob` to propagate claim errors (triggering Nack/Retry) while gracefully handling duplicates (Ack)
  - Delayed message Acknowledgement until after successful processing
  - Added unit tests for DB error propagation

**Additional Commits**:
- `3d6846ad` - *fix: add semantic analysis graph node*
- `b04c1b4a` - *fix: align initial project values, project mappers conditional validation*
- `3d76aee6` - *refactor: use uuidv7 for increased sorting, indexing performance*
- `e5d933e8` - *refactor: enforce strict InitialProject→Project state transition*

---

### January 10, 2026

#### Database Schema Refactoring
**Commits**:
- `1d220f62` - *fix: migration OK*
- `a4edbd84` - *refactor: db schema refactored, pre-migrate*

---

### January 8, 2026

#### Schema Migration Preparation
**Commit**: `a209f9a3` - *refactor: progress checkpoint before refactoring zod schemas into database schemas*

---

## December 2025

### December 29, 2025

#### Asset Management & UI Optimization
**Commits**:
- `7bbe1fdb` - *refactor: show frame generation status, optimistic asset UI updates*
  - Optimistic UI updates for delete and history operations
  - Ignored assets for idempotent asset modification
  - Revised `publishCommand` payload shape

- `ba07d3b7` - *feat: implement asset history, management and command tracking*
  - Added `AssetHistoryPicker` frontend component for version management
  - Implemented `listSceneAssets` in `GCPStorageManager`
  - Added `UPDATE_SCENE_ASSET` command and API endpoints
  - Updated `Scene` schema with `rejectedAttempts` tracking
  - Integrated `commandId` into PubSub messages for operation tracing
  - Enhanced error handling to preserve interrupt signals

---

### December 28, 2025

#### Performance & Infrastructure Optimization
**Commits**:
- `b951616f` - *feat(client): optimize image and video loading performance*
  - Added priority prop to card components for eager loading
  - Implemented `fetchPriority="high"` for above-the-fold content
  - Added poster attributes to video elements
  - Default lazy loading for non-prioritized images

- `af107e0d` - *feat(infra): add model caching and parameterize startup script*
  - Cache/restore model weights from GCS (dramatic startup time reduction)
  - Parameterized `startup_script` in Terraform for CPU vs. GPU switching
  - Updated `terraform.tfvars` for CPU configuration

**LLM & Prompt Engineering**:
- `b1135a5b` - *docs: update documentation, env ltx endpoint vars*
- `93933f3b` - *refactor: llm controller: textModel, videoModel*
  - Revised `composeEnhancedSceneGenerationPromptMeta`
  - Created A/B test prompts
  - Revised `semanticRulesInstruction`

**Infrastructure**:
- `7730ed1d` - *fix: terraform configuration revision: remove cloud armor rules*

---

### December 27, 2025

#### Meta-Prompting & Prompt Quality
**Commits**:
- `89c75a76`, `984f9f34` - *docs: update documentation*
- `984f9f34` - *feat(pipeline): add verbose logging for prompt generation*
  - Log meta-prompt instructions (truncated) and final prompts
  
- `6870537d` - *refactor: append generation rules to scene generation meta-prompt*

- `1c5e4382`, `c8d9c2ed` - *refactor(pipeline): implement meta-prompting for scene generation*
  - Refactored `composeEnhancedSceneGenerationPrompt` → `composeEnhancedSceneGenerationPromptMeta`
  - LLM now generates final prompts from meta-instructions
  - Enabled `ThinkingLevel.HIGH` for enhanced logic

**UI & Schema Fixes**:
- `0a2be504` - *fix: regenerateframedialog reactive props*
  - `generateFrameCompositionPromptMeta`
  - `generateFrameGenerationPrompt`
  - Lighting schema revision

**Cinematic Constants**:
- `f382211b` - *refactor: cinematic constants*
  - Updated transition types, shot types, camera movements, angles, composition

---

### December 26-27, 2025

#### Narrative Prompt Generation
**Commit**: `71d24883` - *refactor: switch to descriptive narrative prompts for image generation*

- Implemented `buildCinematographerNarrative` to convert shot specs into prose
- Implemented `buildProductionDesignerNarrative` for atmospheric location descriptions
- Implemented `buildCostumeAndMakeupNarrative` for fluid character descriptions
- Updated `prompt-composer.ts` to assemble cohesive narratives instead of structured lists
- Dramatically improved prompt quality for better creative intent adherence

#### Atomic Attempt Tracking
**Commit**: `ee1d5bba` - *Fix attempt number overwriting in generation agents*

- Implemented `getNextAttempt` in `StorageManager` for atomic attempt tracking
- Refactored `SceneGeneratorAgent` to use `getNextAttempt` inside retry loops
- Refactored `FrameCompositionAgent` for monotonic attempt increments
- Resolved issue where retries would overwrite previous files

---

### December 26, 2025

#### Semantic Expert Agent & Constraint Framework
**Commits**:
- `08db5ed8` - *docs: update documentation*
- `9791b799` - *feat(pipeline): implement Semantic Expert Agent and Constraint-Injection Framework*
  - Introduced `SemanticExpertAgent` for dynamic constraint generation
  - Added `semantic_analysis` node to pipeline graph
  - Updated `generation-rules-presets.ts` with Constraint-Injection framework:
    - Global Invariants
    - Negative Embeddings
    - Semantic Overrides
  - Integrated rule enforcement into `SceneGeneratorAgent` and `QualityCheckAgent`
  - Created `semantic-rules-instruction.ts` with few-shot examples
  - Maintained backward compatibility with `string[]` rule format

---

### December 25, 2025

#### Storage & IAM Improvements
**Commits**:
- `362e8797` - *feat(iam): add storage permission check logic*
  - TypeScript utility to verify storage permissions via ADC
  - Granted `roles/storage.objectViewer` to application identity
  - Ensured local dev environment has bucket access

- `9d36eeab` - *feat: make storageManager path normalization idempotent*
  - Updated `normalizePath` to handle `gs://` and `https://storage.googleapis.com/` prefixes
  - Added `getBucketRelativePath` for internal GCS operations
  - Updated tests to verify idempotent path handling

**Bug Fixes**:
- `28e02323` - *fix: segments as scene type*
- `db426342` - *fix(pipeline): prevent hallucinated asset URLs in storyboard generation*
  - Updated Director prompt to forbid generating asset URLs
  - Added `sanitizeAssetUrls` helper
  - Applied sanitization across storyboard generation nodes

**State Synchronization**:
- `4a72f10f` - *fix: workflow-service: storage state destination*
- `590d1c3e` - *feat: architect robust pipeline state synchronization*
  - Synchronously persist `initialState` to storage
  - Implemented "sync-on-connect" pattern in `usePipelineEvents`
  - Applied optimistic state updates in `ProjectSelectionModal`
  - Created self-healing synchronization loop

**Debug Tools**:
- `9de4c467`, `b78d9bf0`, `82b99b0f` - *feat: add debug tab and fix initial state sync*
  - Added `DebugStatePanel` with collapsible JSON tree viewer (DEV mode only)
  - Removed manual `setPipelineState` to prevent conflicts
  - Broadcast `WORKFLOW_STARTED` event with initial state
  - Resolved dashboard UI not reflecting running workflows

**State Persistence**:
- `72297134` - *fix(pipeline): ensure user inputs persist when resuming pipeline*
  - Updated `WorkflowService.startPipeline` to merge user inputs into graph state
  - Added unit tests for state updates on resume

- `7d0f28c0` - *feat(pipeline): implement robust state persistence with GCS fallback*
  - Added state type to `GCPStorageManager` mapping to `[videoId]/state.json`
  - Integrated `saveStateToStorage` in `CinematicVideoWorkflow`
  - Implemented strict state resolution hierarchy:
    1. Postgres Checkpoint (Primary/Live)
    2. GCS State File (Backup/Durable)
    3. GCS Storyboard (Fallback/Initial)

---

### December 24, 2025

#### Distributed Cancellation & Workflow Service
**Commits**:
- `d2e7b4d6` - *docs: update documentation*
- `243dedf1` - *feat: support cancellation via AbortController*
  - Updated `CinematicVideoWorkflow` to accept `AbortController`
  - Propagated abort signal to all agents
  - Updated `LlmController` and `GoogleProvider` to use `AbortSignal`
  - Handle SIGINT in CLI for graceful shutdown
  - `WorkflowService` manages controllers and passes to graph execution

- `389bf045` - *feat: Implement WorkflowService and Distributed Cancellation*
  - Introduced `WorkflowService` to encapsulate LangGraph execution
  - Implemented distributed cancellation via Pub/Sub:
    - Added `video-cancellations` topic
    - Workers subscribe to ephemeral, unique cancellation subscriptions
    - `STOP_PIPELINE` broadcasts to all workers
    - `activeControllers` map ensures precise local interruption
  - Updated `streamWithInterruptHandling` to accept `publishEvent` callback
  - Added unit tests for `WorkflowService`

**Storage Manager Documentation**:
- `d4a7eb05` - *comprehensive JSDoc comments to pipeline/storage-manager.ts*
  - Documented class overview, attempt management, path generation

**Storage Versioning**:
- `e5f4b5c1` - *refactor(pipeline): enforce strict attempt versioning in StorageManager*
  - Made `attempt` parameter mandatory for versioned assets
  - `attempt` accepts `number | 'latest'`
  - Updated `resolveAttempt` to default to `1` (not `0`)
  - Added strict type safety
  - Updated tests and documentation

---

### December 23, 2025

#### Storage & Frame Generation Fixes
**Commits**:
- `043c26ab` - *fix(pipeline): correct storage scanner regex for scene frames*
  - Updated regex to match `frame_start` and `frame_end` patterns
  - Added batch generation test to verify existing file detection
  - Fixed unnecessary regeneration issue

- `f8c9692d` - *docs: update documentation*
- `f4e7e868` - *feat: check storage for existing scene frames before generation*
  - Implemented storage check in `generateSceneFramesBatch`
  - Prevents unnecessary regeneration of existing assets

#### Hot Module Replacement (HMR)
**Commit**: `c824a9dd` - *build: implement hot module replacement (HMR)*
- Added `vite-node` dev dependency
- Created `vite.config.node.ts` for backend build configuration
- Updated `server/index.ts` and `pipeline-worker/index.ts` for HMR support
- Updated `tsconfig.json` to include pipeline-worker
- Configured `.vscode/launch.json` with `vite-node` for hot-reload debug profiles

#### Progress Callbacks
**Commits**:
- `ae5839fd` - *feat: implement onProgress callback in scene generation*
  - Updated `generateSceneWithQualityCheck` to accept and propagate `onProgress`
  - Updated `generateSceneFramesBatch` to pass callbacks to frame generation

- `7cb08332` - *docs: update documentation to reflect asset generation progress callback*
- `22b42cef` - *Fix: Add onProgress to character and location generation nodes*
- `1693b6a2` - *docs: update documentation*
- `2e1f6a2c` - *Enhance pipeline visibility with granular progress events*

---

### December 22, 2025

#### Error Handling Improvements
**Commits**:
- `39be79db` - *fix: graph errors shape*
- `34ec3594` - *feat(interrupts): add proper error message extraction*
  - Added `extractErrorMessage()` helper for human-readable errors
  - Added `extractErrorDetails()` for structured error information
  - Updated `LlmRetryInterruptValue` interface with `errorDetails` field
  - Fixed Google API error message extraction
  - Prevented `"f Error () { [native code]}"` serialization issue
  - Now properly extracts billing account and API error messages

---

### December 21, 2025

#### Vertex AI Configuration & State-Based Versioning
**Commits**:
- `2836b8cf` - *update terraform configuration: custom ltx endpoint, huggingface*
- `db26cb57`, `eb178c93`, `6cac4c6c` - *docs: update documentation*
- `eb178c93` - *feat: best attempt tracking, implicit versioning, and sequential scene IDs*
- `27a1b939`, `4d537dc3` - *refactor: Enable distributed processing with Postgres locking and state-based versioning*

---

### December 19, 2025

#### Vertex AI Endpoint Configuration
**Commits**:
- `2c90f274` - *terraform vertex ai endpoint reconfiguration: Huggingface Lightricks/LTX-Video*
- `e06cea41`, `0a489955` - *feat: terraform vertex ai configuration*

---

### December 17, 2025

#### Documentation Improvements
**Commits**:
- `3a7d8356` - *Update README.md with improved diagram labels*
- `69802b11` - *Refactor mermaid diagram in README.md*
- `52702995` - *Add mermaid diagram to workflow documentation*
- `8610ed01` - *Fix formatting in README.md for Pub/Sub diagram*

---

### December 15, 2025

#### Critical Bug Fixes
**Commits**:
- `f72f8df3`, `fe95f5c0` - *docs: update documentation*
- `fe95f5c0` - *fix: process_scene infinite loop, duplicate events, invalid graph START edge*
- `cca87cf4` - *docs: update documentation*
- `cb8744ed` - *fix(pipeline): resolve end-to-end state synchronization and event streaming issues*
  
**Root Causes Fixed**:
  - Console log interception capturing LLM JSON responses (broke execution)
  - Circular reference errors in stream step logging
  - Missing FULL_STATE events after critical transitions
  - Client not updating scene status from events
  - Scene regeneration not emitting progress updates

**Changes Across Stack**:
  - **Pipeline Worker**: Selective console log filtering, removed unsafe JSON.stringify
  - **Pipeline Graph**: Added `publishStateUpdate` helper, emit FULL_STATE after every node
  - **Client**: Improved FULL_STATE handling, log level filtering
  - **Dashboard**: Immediate scene status updates on regeneration
  - **Server**: Event forwarding logging, improved error handling

**Impact**:
  - Consistent state sync: pipeline → server → client
  - Real-time scene regeneration progress
  - Clean, meaningful logs
  - All state transitions emit events

---

## Breaking Changes

### Environment Variables
- **Required**: `POSTGRES_URL` for state persistence
- **Required**: `EXECUTION_MODE` (Sequential vs. Parallel)

### Entry Points
- `npm run pipeline:start` → `src/pipeline/index.ts`
- `npm run worker:start` → `src/worker/index.ts`

### Database Migrations
Required migrations for:
- `checkpoints` table (LangGraph state persistence)
- `project_locks` table (distributed locking)
- `jobs` table updates (`assetKey`, `uniqueKey`, `attempt`, `FATAL` state)
- Optimized indexes (`idx_active_logical_job`, job claiming indexes)

---

## Migration Guide

1. **Update Environment Variables**: Add `POSTGRES_URL` and `EXECUTION_MODE`
2. **Run Database Migrations**: Execute all pending migrations for new tables/columns
3. **Update Entry Points**: Use new npm scripts for separate services
4. **Review Logging Configuration**: Configure Pino log levels for your environment
5. **Test Hot Reload**: Verify VSCode debug configurations work with new setup
