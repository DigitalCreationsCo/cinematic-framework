### __Implementation Plan__

- [x] __Phase 1: Local Development Environment (Docker) - Updated for Client & Remote Postgres__

  - [x] Create a `docker-compose.yml` file at the project root.
  - [ ] Configure `pipeline-worker` service in `docker-compose.yml` to depend on the *remote* Postgres and set `POSTGRES_URL`.
  - [ ] Add `client` service to `docker-compose.yml`.
  - [x] Define three services: `pubsub-emulator`, `pipeline-worker`, and `api-server`.
  - [x] Configure environment variables for all services to connect to the Pub/Sub emulator.

- [ ] __Phase 2: Pub/Sub & Checkpointer Integration__

  - [x] Add the `@google-cloud/pubsub` dependency to both the `api-server` and `pipeline-worker`.
  - [ ] Add `@langchain/langgraph-checkpoint-postgres` and `pg` dependencies to `package.json`.
  - [x] In `shared/`, update the Pub/Sub message schemas to include the new `STOP_PIPELINE` command.
  - [ ] Create `pipeline-worker/checkpointer-manager.ts` using the provided example as a template.

- [ ] __Phase 3: Pipeline Wrapper Service (Updated for Checkpointer & Stop Command)__

  - [x] Create `pipeline-worker/` directory with `Dockerfile` and `index.ts` (skeleton).

  - [ ] Remove the in-memory `activePipelines` map from `pipeline-worker/index.ts`.

  - [ ] Integrate `checkpointerManager` into `pipeline-worker/index.ts` to load/save `GraphState` from PostgreSQL.

  - [ ] In `START_PIPELINE` command handler:

    - Initialize `CinematicVideoWorkflow`.
    - Load `GraphState` using `checkpointerManager.loadCheckpoint()`.
    - Compile graph with `checkpointerManager.getCheckpointer()`.
    - Stream graph and `put` each step's state to checkpointer.

  - [ ] Implement `REQUEST_FULL_STATE` command handler:

    - Load latest `GraphState` using `checkpointerManager.loadCheckpoint()`.
    - Publish `FULL_STATE` event.

  - [ ] Implement `RETRY_SCENE` logic using `checkpointerManager` to load, modify, and save state.

  - [ ] Implement `STOP_PIPELINE` command handler to gracefully abort a running graph and save its checkpointed state.

  - [ ] Rename relevant variables for verbose functional clarity within `pipeline-worker/` and Pub/Sub related code.

- [x] __Phase 4: Stateless API Server (Updated for Stop Command)__

  - [x] Refactor the server to be completely stateless.
  - [x] When a new client connects, the server will create a subscription to the `video-events` topic.
  - [x] The server will immediately publish a `REQUEST_FULL_STATE` command.
  - [x] As events are received from Pub/Sub, they will be directly written to the client's SSE response stream.
  - [x] The command endpoints (`/api/video/start`, etc.) will simply validate requests and publish commands to the `video-commands` topic.
  - [ ] Add `POST /api/video/stop` endpoint to publish a `STOP_PIPELINE` command.
  - [ ] Rename relevant variables for verbose functional clarity within `server/` and Pub/Sub related code.

- [ ] __Phase 5: Client-Side Enhancements (Updated for Stop Command & UI)__

  - [ ] Simplify the `use-pipeline-events.ts` hook. The first message received will be the full state, which will hydrate the entire UI.
  - [ ] Implement loading skeletons using the existing UI component library for `SceneCard`, `FramePreview`, and other components that will display asynchronously loaded data.
  - [ ] Add functionality to issue `STOP_PIPELINE` commands from the client.
  - [ ] Rename relevant variables for verbose functional clarity.

