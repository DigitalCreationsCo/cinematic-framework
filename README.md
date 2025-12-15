# Cinematic Framework

An AI-powered cinematic video generation framework that transforms creative prompts and audio into professional-quality videos or music videos with continuity, character consistency, and cinematic storytelling.

## Overview

Cinematic Framework leverages Google's Vertex AI (Gemini models) and LangGraph to orchestrate a sophisticated multi-agent workflow that:

- **Analyzes audio tracks** to extract musical structure, timing, and emotional beats
- **Generates detailed storyboards** with scenes, characters, locations, and cinematography
- **Maintains visual continuity** across scenes using reference images and persistent state checkpoints
- **Produces cinematic videos** with proper shot composition, lighting, and camera movements
- **Stitches scenes** into a final rendered video synchronized with audio
- **Self-improves** its generation process by learning from quality-check feedback, utilizing enhanced evaluation guidelines.
- **Tracks learning metrics** and persists state robustly using PostgreSQL via LangGraph checkpointers.

## Features

- **Audio-Driven and/or Prompt-Based**: Generate videos from audio files (with automatic scene timing) and/or from creative prompts
- **Multi-Agent Architecture**: Specialized agents for audio analysis, storyboard composition, character/location management, scene generation, and quality control
- **Role-Based Prompt Architecture**: Film production crew roles (Director, Cinematographer, Gaffer, Script Supervisor, etc.) compose prompts for specialized, high-quality output. See [PROMPTS_ARCHITECTURE.md](docs/PROMPTS_ARCHITECTURE.md) for architecture details and [WORKFLOW_INTEGRATION.md](docs/WORKFLOW_INTEGRATION.md) for integration status.
- **Self-Improving Generation**: A `QualityCheckAgent` evaluates generated scenes and provides feedback. This feedback is used to refine a set of "Generation Rules" that guide subsequent scene generations, improving quality and consistency over time.
- **Learning Metrics**: The framework tracks the number of attempts and quality scores for each scene, calculating trend lines to provide real-time feedback on whether the system is "learning" (i.e., requiring fewer attempts to generate high-quality scenes).
- **Visual Continuity**: Maintains character appearance and location consistency using reference images and **pre-generated start/end frames** for each scene, with intelligent skipping of generation if frames already exist in storage, now governed by persistent checkpoints.
- **Cinematic Quality**: Professional shot types, camera movements, lighting, and transitions
- **Persistent State & Resume Capability**: Workflow state is persisted in PostgreSQL via LangGraph checkpointers, allowing for robust resumption and enabling command-driven operations like STOP/RETRY via Pub/Sub commands.
- **Comprehensive Schemas**: Type-safe data structures using Zod for all workflow stages, defined in [shared/schema.ts](shared/schema.ts).
- **Automatic Retry Logic**: Handles API failures and safety filter violations, centrally managed via command handlers in the pipeline worker service.

## Architecture

The framework uses a **LangGraph state machine** running in a dedicated `pipeline-worker` service (using Node 20+). Execution is controlled via commands published to a Pub/Sub topic (`video-commands`). State changes are broadcast via another Pub/Sub topic (`video-events`), which the API server relays to connected clients via SSE.

```mermaid
graph TD
    A[Client/API] -->|Publish Command (START/STOP/RETRY)| B(Pub/Sub: video-commands);
    B --> C[Pipeline Worker: pipeline-worker];
    C -->|Check/Save State| D[(PostgreSQL Checkpoint)];
    C -->|Execute Graph| E[LangGraph Workflow];
    C -->|Publish State Update| F(Pub/Sub: video-events);
    F --> G[API Server];
    G -->|SSE Stream| A;
    
    subgraph Workflow Execution
        E
        D
    end
  ```

### Key Components & Agents

1.  **AudioProcessingAgent**: Analyzes audio files to extract musical structure, timing, and mood, setting initial scene parameters.
2.  **CompositionalAgent**: Expands creative prompts and generates comprehensive storyboards.
3.  **ContinuityManagerAgent**: Manages character and location reference images, ensuring visual coherence by checking and generating start/end frames for scenes based on persistent state context.
4.  **SceneGeneratorAgent**: Generates individual video clips, now relying on pre-generated start/end frames from the persistent state for continuity.
5.  **QualityCheckAgent**: Evaluates generated scenes for quality and consistency, feeding back into the prompt/rule refinement loop.
6.  **Prompt CorrectionInstruction**: Guides the process for refining prompts based on quality feedback.
7.  **Generation Rules Presets**: Proactive domain-specific rules that can be automatically added to guide generation quality.
8.  **Pipeline Worker (`pipeline-worker/`)**: A dedicated service running the LangGraph instance using Node.js v20+. It handles command execution (`START_PIPELINE`, `STOP_PIPELINE`, `RETRY_SCENE`) and uses the `PostgresCheckpointer` for reliable state management. **It now intercepts all console logs and publishes them to the client as real-time `LOG` events via Pub/Sub.** It now uses `node` directly for execution, replacing `tsx`.
9.  **API Server (`server/`)**: Now stateless, it acts as a proxy, publishing client requests as Pub/Sub commands and streaming Pub/Sub events back to the client via project-specific SSE connections managed via temporary Pub/Sub subscriptions. It initializes a Google Cloud Storage client upon startup to support project listing and metadata retrieval.

## Prerequisites

- **Node.js** (v20 or higher recommended for pipeline worker)
- **Docker** and **Docker Compose** (for local development environment)
- **Google Cloud Project** with:
  - Vertex AI API enabled
  - Google Cloud Storage bucket created
  - Service account with appropriate permissions

## Installation (Local Development with Docker)

The local setup now requires running Docker Compose to manage the background services:

```bash
# 1. Install dependencies for API/Worker/Client
npm install

# 2. Start necessary infrastructure components (Pub/Sub Emulator, API Server, Client)
docker-compose up --build -d

# Note: The postgres-db service is started automatically by docker-compose if needed by the worker, but is not externally exposed or required by the API server anymore.
```

## Local Development (Without Docker)

For faster iteration and debugging, you can run the services directly using `tsx` outside of Docker. You will need to start the dependency containers first.

```bash
# 1. Start the dependent infrastructure (Postgres and Pub/Sub Emulator)
# Ensure you use the appropriate docker-compose file if needed, or run the services separately.
# Example: docker-compose up -d pubsub-emulator postgres-db

# 2. Start the Client (e.g., in VS Code integrated terminal)
npm run dev

# 3. Start the Server (The API layer)
npm run start:server

# 4. Start the Worker (The LangGraph execution environment)
npm run start:worker

# Alternatively, use the new VS Code Debug Configurations:
# - Launch Worker
# - Launch Server
# - Debug Client
# - Debug Full-Stack (launches all 3)
```

## Configuration

### Environment Variables
Update `.env` (or environment variables in deployment). **The API Server now explicitly loads environment variables using `dotenv` upon startup.** Note that `GCP_PROJECT_ID`, `GCP_BUCKET_NAME`, and `POSTGRES_URL` are required for full operation.

```bash
# Google Cloud Platform Configuration
GCP_PROJECT_ID="your-gcp-project-id"
GCP_BUCKET_NAME="your-gcp-bucket-name"
PUBSUB_EMULATOR_PROJECT_ID="test-project" # Required for Pub/Sub operations
PUBSUB_EMULATOR_HOST="" # Set this to 'pubsub-emulator:8085' when running in Docker, or 'localhost:8085' when running locally outside Docker. Leave blank if using actual Pub/Sub service.
# GOOGLE_APPLICATION_CREDENTIALS is often omitted when using ADC or Workload Identity
# POSTGRES_URL must point to the database accessible by the pipeline worker
POSTGRES_URL="postgres://postgres:example@postgres-db:5432/cinematiccanvas"

# LLM Configuration
LLM_PROVIDER="google" # Only supports google
TEXT_MODEL_NAME="gemini-2.5-flash" # Updated default model
IMAGE_MODEL_NAME="imagen-3"
VIDEO_MODEL_NAME="veo-2.0-generate-exp"
```

### Required GCP Permissions
Your service account needs the following IAM roles:
- `storage.objectAdmin` or `storage.objectCreator` + `storage.objectViewer` on the bucket
- `aiplatform.user` for Vertex AI API access

## Usage (API Interaction)

Pipeline execution is initiated via API calls that publish commands to Pub/Sub, allowing the decoupled worker service to pick them up. The API server also provides endpoints for querying current state and available projects, leveraging direct GCS access for the latter.

### Starting a Pipeline
Use POST to `/api/video/start`. This publishes a `START_PIPELINE` command.

```bash
curl -X POST http://localhost:8000/api/video/start \
-H "Content-Type: application/json" \
-d '{
  "projectId": "new-video-id-12345",
  "audioUrl": "gs://my-bucket/audio/song.mp3",
  "creativePrompt": "A 1980s VHS-style music video..."
}'
```

### Stopping a Pipeline
Use POST to `/api/video/stop`. This publishes a `STOP_PIPELINE` command, causing the worker to save its current state and terminate processing for that run ID.

```bash
curl -X POST http://localhost:8000/api/video/stop \
-H "Content-Type: application/json" \
-d '{
  "projectId": "new-video-id-12345"
}'
```


### Listing Available Projects
Use GET to `/api/projects`. This queries the configured GCS bucket directly to list existing project directories (prefixes). **The API now returns a JSON object `{ "projects": [...] }` instead of an array.** The listing now excludes any project directory named 'audio' to prevent accessing raw audio assets.

### Viewing Live State Updates (SSE)
Client applications connect to `/api/events/:projectId` to receive real-time state updates via SSE, which relies on the worker publishing to the `video-events` topic.

## Project Structure

```
cinematic-canvas/
├── .keeper/                          # Agent task tracking
├── audio/                            # Local audio files for testing
├── client/                           # Frontend application (React/Vite)
├── docs/                             # Documentation files
├── pipeline-worker/                 # Dedicated service for running LangGraph/Checkpointer (Uses Node 20, runs via 'node index.ts')
│   ├── Dockerfile
│   ├── checkpointer-manager.ts       # Abstraction for Postgres checkpointer (LangGraph state serialization change)
│   └── index.ts                      # Main worker logic subscribing to Pub/Sub commands
├── pipeline/                         # Core workflow agents and logic
│   ├── agents/                       # Agent implementations
│   ├── llm/                          # LLM provider abstractions
│   ├── lib/                          # Utility libraries
│   ├── prompts/                      # System prompts for agents
│   ├── index.ts                      # Core graph definition (Uses import.meta.main)
│   └── types.ts
├── server/                           # Stateless API server
│   ├── index.ts                      # Server entry point and SSE implementation
│   └── routes.ts                     # API routing and Pub/Sub command publishing
├── shared/                           # Shared types/schemas used across client, server, and worker
│   ├── pipeline-types.ts             # GraphState and domain types
│   ├── pubsub-types.ts               # Command/Event structures (e.g., START_PIPELINE)
│   └── schema.ts
├── .env.example
├── package.json                      # Dependencies and scripts
├── docker-compose.yml                # Local development orchestration (Postgres service removed)
├── Dockerfile.api                    # Dockerfile for API/Server (Uses Node 20)
└── ...
```

## Dependencies

### Core Dependencies (Updated)
- **@google-cloud/pubsub** (^5.2.0): For command/event communication between services.
- **@langchain/langgraph-checkpoint-postgres** (^1.0.0): For persistent state management, handling LangGraph Checkpoint objects directly.
- **pg** (^8.12.0): PostgreSQL client library used by the checkpointer.
- **uuid** (^13.0.0): Used by the API server for unique SSE subscription IDs.

### Development Dependencies
(No major changes observed in dev dependencies relevant to this file, retaining existing list below for completeness)

- **typescript** (^5.9.3): TypeScript compiler
- **vitest** (^4.0.14): Testing framework
- **@vitest/coverage-v8** (^4.0.14): Code coverage
- **ts-node** (^10.9.2): TypeScript execution

## Configuration
### Environment Variables (Docker Compose Context)
When running locally via `docker-compose.yml`, the following variables are implicitly set or need external definition for services connecting to external GCP resources (if not using the emulator):
- `PUBSUB_EMULATOR_HOST`: Points to the local Pub/Sub emulator container.
- `POSTGRES_URL`: Connection string for the service database.
- `GCP_PROJECT_ID`, `GCP_BUCKET_NAME`: GCP resource identifiers.
- `GCP_PROJECT_ID`: Project ID for Pub/Sub operations (used by worker/server if not using emulator host).

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run coverage
```

## Security: Google Cloud Credentials & Data Access

**State Persistence**: All workflow progress, scenes, characters, and metrics are now persisted in a PostgreSQL database via LangGraph checkpoints (`thread_id` corresponds to `projectId`). The API server no longer directly interacts with the DB for state retrieval, relying on worker-published events or dedicated state API calls.

(Rest of Security section regarding GCP keys remains largely unchanged, referencing correct environment variables.)

## Troubleshooting

### Common Issues (Updated)
- **Issue: "Failed to connect to database"**
  - Solution: Ensure the `pipeline-worker` service can access PostgreSQL. If running locally, check the `POSTGRES_URL` in `.env` or passed to the worker environment. The `postgres-db` service might need manual verification if not running via compose.
- **Issue: "Pipeline did not resume / Ran from beginning"**
  - Solution: Verify that the `projectId` used matches the `thread_id` saved in the database, and that the `pipeline-worker` service is correctly deserializing checkpoint state (`channel_values`).
- **Issue: "Video generation timed out"**
  - Solution: Increase timeout settings configured within the pipeline agents or pipeline worker environment.
- **Issue: "Safety filter triggered"**
  - Solution: The framework automatically sanitizes prompts. Review safety error codes in pipeline agents.
- **Issue: "FFmpeg errors"**
  - Solution: Verify FFmpeg is installed and accessible in the `pipeline-worker` container's PATH.

## Performance Considerations
- **Scene generation**: ~2-5 minutes per scene (API dependent)
- **Total workflow time**: Highly dependent on retry counts, as failures are now managed via command/checkpointing, not just internal retries. A stalled pipeline can be explicitly stopped via API command.

## Limitations
- Video durations must be exactly 4, 6, or 8 seconds (Vertex AI constraint).
- Maximum 15-minute timeout per scene generation.
- Requires significant GCP quota for video generation API.

## Contributing

Contributions are welcome! Please ensure:
- All tests pass (`npm test`)
- Code coverage remains above 90% (`npm run coverage`)
- TypeScript strict mode compliance
- New services (e.g., `pipeline-worker`) are properly containerized (Node 20+) and configured in `docker-compose.yml`.

## License

ISC

## Support

For issues and questions:
- Review Docker Compose logs (`docker-compose logs`).
- Check PostgreSQL database for state inconsistencies.
- Review Pub/Sub topic messages if commands are not reaching the worker.