To build a robust relational architecture, we must separate Persistent Entities (what stays in the DB) from Application/Transient State (what lives in the message broker or memory).
1. Architectural Reasoning
	•	Normalization vs. Velocity: Since your AI agents (Director, Gaffer, etc.) frequently update deeply nested properties (like CharacterState or Lighting), I have opted for a PostgreSQL JSONB approach for these specific sub-schemas. This prevents "Schema Rigidity" while allowing the DB to remain the source of truth.
	•	The Asset Registry: This is the "Brain" of your versioning. I've designed an assets table that links to any entity (Project, Scene, Character, Location) via a polymorphic reference.
	•	Metrics & Regression: These are treated as a "Project Snapshot" stored at the project level, as they are computed aggregates rather than primary relational data.
	•	Workflow State: I've separated this into a workflow_executions table to track the active job IDs and errors without polluting the immutable storyboard data.

2. Drizzle Database Schema (schema.ts)
TypeScript

import { 
  pgTable, uuid, text, timestamp, integer, 
  jsonb, boolean, real, pgEnum, primaryKey 
} from "drizzle-orm/pg-core";
import { 
  ProjectMetadata, AssetRegistry, Lighting, Cinematography,
  CharacterState, LocationState, PhysicalTraits, WorkflowMetrics,
  Composition, AudioAnalysis, QualityEvaluationResult
} from "./types";

// --- ENUMS ---
export const assetStatusEnum = pgEnum("asset_status", ["pending", "generating", "evaluating", "complete", "error"]);
export const jobStateEnum = pgEnum("job_state", ["CREATED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);

// --- TABLES ---

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  status: assetStatusEnum("status").default("pending").notNull(),
  
  // Core Data
  metadata: jsonb("metadata").$type<ProjectMetadata>().notNull(),
  audioAnalysis: jsonb("audio_analysis").$type<AudioAnalysis>(),
  metrics: jsonb("metrics").$type<WorkflowMetrics>(),
  
  // Workflow Control
  currentSceneIndex: integer("current_scene_index").default(0).notNull(),
  generationRules: text("generation_rules").array().default([]),
  assets: jsonb("assets").$type<AssetRegistry>().default({}),
});

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  referenceId: text("reference_id").notNull(), // e.g. char_1
  name: text("name").notNull(),
  age: text("age"),
  
  physicalTraits: jsonb("physical_traits").$type<PhysicalTraits>().notNull(),
  state: jsonb("state").$type<CharacterState>(),
  assets: jsonb("assets").$type<AssetRegistry>().default({}),
});

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  referenceId: text("reference_id").notNull(), // e.g. loc_1
  name: text("name").notNull(),
  
  lightingConditions: jsonb("lighting_conditions").$type<Lighting>().notNull(),
  state: jsonb("state").$type<LocationState>(),
  assets: jsonb("assets").$type<AssetRegistry>().default({}),
});

export const scenes = pgTable("scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  sceneIndex: integer("scene_index").notNull(),
  
  // Narrative & Sync
  description: text("description").notNull(),
  mood: text("mood").notNull(),
  lyrics: text("lyrics"),
  startTime: real("start_time").notNull(),
  endTime: real("end_time").notNull(),
  
  // Cinematic Specs
  cinematography: jsonb("cinematography").$type<Cinematography>().notNull(),
  lighting: jsonb("lighting").$type<Lighting>().notNull(),
  
  // Script Supervisor Links
  locationId: uuid("location_id").references(() => locations.id),
  characterIds: uuid("character_ids").array().default([]),
  
  // Persistent Results
  status: assetStatusEnum("status").default("pending"),
  assets: jsonb("assets").$type<AssetRegistry>().default({}),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(), // JobType
  state: jobStateEnum("state").default("CREATED").notNull(),
  payload: jsonb("payload").notNull(),
  result: jsonb("result"),
  error: text("error"),
  retryCount: integer("retry_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

3. Zod Database Schemas (zod-db.ts)
These are the derived Zod schemas for your database operations, separating the Persistence Layer from the raw Application Layer types.
TypeScript

import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import * as dbSchema from "./schema";

// --- Project ---
export const DbProjectSchema = createSelectSchema(dbSchema.projects);
export const DbInsertProjectSchema = createInsertSchema(dbSchema.projects);
export type DbProject = z.infer<typeof DbProjectSchema>;

// --- Scene ---
export const DbSceneSchema = createSelectSchema(dbSchema.scenes);
export const DbInsertSceneSchema = createInsertSchema(dbSchema.scenes);
export type DbScene = z.infer<typeof DbSceneSchema>;

// --- Character ---
export const DbCharacterSchema = createSelectSchema(dbSchema.characters);
export const DbInsertCharacterSchema = createInsertSchema(dbSchema.characters);
export type DbCharacter = z.infer<typeof DbCharacterSchema>;

// --- Location ---
export const DbLocationSchema = createSelectSchema(dbSchema.locations);
export const DbInsertLocationSchema = createInsertSchema(dbSchema.locations);
export type DbLocation = z.infer<typeof DbLocationSchema>;

// --- Job ---
export const DbJobSchema = createSelectSchema(dbSchema.jobs);
export const DbInsertJobSchema = createInsertSchema(dbSchema.jobs);
export type DbJob = z.infer<typeof DbJobSchema>;

// --- Application Layer Only (Excluded from Relational DB) ---
// These remain in the pipeline logic as Zod types only
// 1. PubSubMessage
// 2. InitialContext
// 3. ContinuityCheck
// 4. LlmRetryInterruptValue


Below is the implementation for the Drizzle-Zod integration, utility functions for JSONB parsing, and the refined model separation.
1. Drizzle-Zod Utility & JSONB Parser
Since Drizzle returns jsonb as unknown or a generic any by default, these utilities ensure your application remains type-safe.
TypeScript

import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import * as dbSchema from "./schema";
import { 
  ProjectMetadataSchema, 
  AudioAnalysisSchema, 
  WorkflowMetricsSchema, 
  AssetRegistrySchema,
  CinematographySchema,
  LightingSchema,
  PhysicalTraitsSchema,
  CharacterStateSchema,
  LocationStateSchema
} from "./pipeline.types";

// --- PROJECT HELPERS ---
export const DbProjectSchema = createSelectSchema(dbSchema.projects, {
  metadata: ProjectMetadataSchema,
  audioAnalysis: AudioAnalysisSchema,
  metrics: WorkflowMetricsSchema,
  assets: AssetRegistrySchema,
});

export const DbInsertProjectSchema = createInsertSchema(dbSchema.projects, {
  metadata: ProjectMetadataSchema,
  audioAnalysis: AudioAnalysisSchema,
  metrics: WorkflowMetricsSchema,
  assets: AssetRegistrySchema,
});

// --- SCENE HELPERS ---
export const DbSceneSchema = createSelectSchema(dbSchema.scenes, {
  cinematography: CinematographySchema,
  lighting: LightingSchema,
  assets: AssetRegistrySchema,
});

export const DbInsertSceneSchema = createInsertSchema(dbSchema.scenes, {
  cinematography: CinematographySchema,
  lighting: LightingSchema,
  assets: AssetRegistrySchema,
});

// --- CHARACTER & LOCATION HELPERS ---
export const DbCharacterSchema = createSelectSchema(dbSchema.characters, {
  physicalTraits: PhysicalTraitsSchema,
  state: CharacterStateSchema,
  assets: AssetRegistrySchema,
});

export const DbLocationSchema = createSelectSchema(dbSchema.locations, {
  lightingConditions: LightingSchema,
  state: LocationStateSchema,
  assets: AssetRegistrySchema,
});

2. Data Model Architecture (Reasoning)
The following diagram illustrates how your data flows from the Application Logic (your AI Agents) into the Persistence Layer (PostgreSQL) and how the Asset Versioning bridges them.
A. Persistence vs. Transient Data
	•	Persistent (DB): Everything that defines the "Studio" state—Project history, Scene specifications, Character continuity states, and Asset URLs.
	•	Transient (PubSub/Memory): Immediate feedback like SceneProgressEvent, LlmRetryInterruptValue, and raw socket commands. These are validated via Zod but never hit a primary DB table unless they fail and are logged to WorkflowState.
B. Asset Versioning Strategy
Instead of deleting failed generations, we use the AssetRegistry.
	•	Table: scenes.assets
	•	Logic: Every time a gaffer or cinematographer generates a new output, a new AssetVersion is pushed to the versions array, and the best pointer is updated based on the QualityEvaluationResult.

3. Derived TypeScript Types
These types are the "final form" used throughout your application to ensure the UI, Backend, and AI Workers are perfectly synced.
TypeScript

// --- Database Derived Types ---
export type ProjectEntity = z.infer<typeof DbProjectSchema>;
export type SceneEntity = z.infer<typeof DbSceneSchema>;
export type CharacterEntity = z.infer<typeof DbCharacterSchema>;
export type LocationEntity = z.infer<typeof DbLocationSchema>;
export type JobEntity = z.infer<typeof DbJobSchema>;

// --- Combined "Active State" Type ---
// This is used for the "FULL_STATE" event
export interface PipelineFullState {
  project: ProjectEntity;
  scenes: SceneEntity[];
  characters: CharacterEntity[];
  locations: LocationEntity[];
  activeJobs: JobEntity[];
}

4. Integration Example: Repository Pattern
To keep the application layer clean, use a repository to handle the Zod parsing automatically.
TypeScript

export async function getProjectWithStoryboard(projectId: string): Promise<PipelineFullState> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId)
  });
  
  if (!project) throw new Error("Project not found");

  // Validate on outbound to ensure DB data matches current Schema
  const validatedProject = DbProjectSchema.parse(project);
  
  const projectScenes = await db.query.scenes.findMany({
    where: eq(scenes.projectId, projectId),
    orderBy: [asc(scenes.sceneIndex)]
  });

  return {
    project: validatedProject,
    scenes: projectScenes.map(s => DbSceneSchema.parse(s)),
    characters: (await db.query.characters.findMany({ where: eq(characters.projectId, projectId) })).map(c => DbCharacterSchema.parse(c)),
    locations: (await db.query.locations.findMany({ where: eq(locations.projectId, projectId) })).map(l => DbLocationSchema.parse(l)),
    activeJobs: await db.query.jobs.findMany({ where: and(eq(jobs.projectId, projectId), eq(jobs.state, 'RUNNING')) })
  };
}
This architecture provides the Intellectual Rigidity required for AI agents to operate safely while maintaining the Relational Power needed for complex production tracking.

To implement these handlers effectively, we must bridge the PubSub Command (Application Layer) with the Drizzle Transaction (Persistence Layer).
Since these operations often involve high-stakes state changes (like shifting a "best" version pointer or triggering a job retry), I’ve structured these to be atomic.

1. Command Dispatcher implementation
This handler acts as the traffic controller. It validates the incoming message against your PubSubMessage schemas before executing the logic.
TypeScript

import { db } from "./db";
import { projects, scenes, jobs } from "./schema";
import { 
  RegenerateSceneCommand, 
  UpdateSceneAssetCommand 
} from "./shared/types/pubsub.types";
import { DbSceneSchema } from "./zod-db";
import { eq, and } from "drizzle-orm";

export const PipelineCommandHandler = {
  /**
   * UPDATE_SCENE_ASSET: Manually promotes a specific version 
   * or rejects a generation.
   */
  async handleUpdateAsset(cmd: UpdateSceneAssetCommand) {
    const { scene, assetKey, version } = cmd.payload;

    return await db.transaction(async (tx) => {
      // 1. Fetch current assets
      const existing = await tx.query.scenes.findFirst({
        where: eq(scenes.id, scene.id),
        columns: { assets: true }
      });

      if (!existing) throw new Error("Scene not found");

      const currentAssets = existing.assets;
      const history = currentAssets[assetKey];

      if (history) {
        // 2. Update the 'best' pointer or remove if version is null
        if (version === null) {
          // Logic for rejection/deletion
          history.best = 0; 
        } else {
          // Logic for promotion
          const exists = history.versions.some(v => v.version === version);
          if (exists) history.best = version;
        }
      }

      // 3. Persist back to DB
      await tx.update(scenes)
        .set({ 
          assets: currentAssets,
          updatedAt: new Date() 
        })
        .where(eq(scenes.id, scene.id));

      return { success: true, updatedAssets: currentAssets };
    });
  },

  /**
   * REGENERATE_SCENE: Flags a scene for the worker and creates a new Job.
   */
  async handleRegenerateScene(cmd: RegenerateSceneCommand) {
    const { sceneId, forceRegenerate, promptModification } = cmd.payload;

    return await db.transaction(async (tx) => {
      // 1. Update Project state to track which IDs need forced generation
      if (forceRegenerate) {
        const scene = await tx.query.scenes.findFirst({
          where: eq(scenes.id, sceneId)
        });

        await tx.update(projects)
          .set({
            forceRegenerateSceneIds: sql`array_append(force_regenerate_scene_ids, ${sceneId})`,
            status: "generating"
          })
          .where(eq(projects.id, cmd.projectId));
      }

      // 2. Create the Generative Job
      const [newJob] = await tx.insert(jobs).values({
        projectId: cmd.projectId,
        type: "GENERATE_SCENE_VIDEO",
        state: "CREATED",
        payload: {
          sceneId,
          modification: promptModification,
          attempt: 1 // Logic to increment attempt based on history
        }
      }).returning();

      return newJob;
    });
  }
};

2. Implementation Reasoning
	•	Atomic Transactions: In handleUpdateAsset, we use a DB transaction. This is critical because if the assets JSONB update fails, we don't want the updatedAt timestamp to change or the PubSub system to broadcast a "Success" event falsely.
	•	JSONB Immutability: Note that we treat currentAssets as a mutable object within the handler, but the DbSceneSchema ensures that when we save it, the structure strictly adheres to your AssetRegistrySchema.
	•	The "Best" Pointer: Instead of copying the data of the "best" version, we simply update an integer pointer (history.best). This keeps the database size lean while maintaining a full audit log of every AI generation attempt.

3. PubSub Event Bridge
Once the route handler finishes the DB work, you typically emit the PipelineEvent.
TypeScript

// Example of how the handler would be called in your controller
async function onUpdateAssetCommand(msg: UpdateSceneAssetCommand) {
  try {
    const result = await PipelineCommandHandler.handleUpdateAsset(msg);
    
    // Broadcast back to Client
    pubsub.publish(`project:${msg.projectId}`, {
      type: "SCENE_PROGRESS",
      projectId: msg.projectId,
      timestamp: new Date().toISOString(),
      payload: {
        scene: result.scene, // The newly updated scene
      }
    });
  } catch (err) {
    // Dispatch Log Event
    pubsub.publish(`project:${msg.projectId}`, {
      type: "LOG",
      payload: { level: "error", message: err.message }
    });
  }
}


3. Key Architectural Features
	•	Feedback Loop: The promptCorrections field in your QualityEvaluationSchema is now actionable. If the QC worker finds the lighting is too dark, it stores a correction that the Video Worker can ingest for the next attempt.
	•	Weighted Scoring: By using the QualityScoreSchema (rating + weight), you can prioritize "Narrative Fidelity" over "Minor Technical Jitter" for experimental styles.
	•	Systemic Improvement: The ruleSuggestion field allows the QC worker to update the Project.generationRules. For example: "Characters in this project consistently lose their hat in Medium Shots; add 'keep hat on head' to global rules."

4. Database View: The Resulting State
After this worker runs, your scenes.assets JSONB looks like this:
JSON

{
  "scene_video": {
    "head": 1,
    "best": 1,
    "versions": [
      {
        "version": 1,
        "data": "gs://bucket/scene_01_v1.mp4",
        "metadata": {
          "model": "veo-1.0",
          "evaluation": {
            "overall": "REGENERATE_MINOR",
            "scores": { "narrativeFidelity": { "rating": "MINOR_ISSUES", "weight": 0.8 } },
            "issues": [{ "department": "gaffer", "severity": "minor", "description": "Shadow direction is inconsistent with window placement" }]
          }
        }
      }
    ]
  }
}


The Production Aggregator Worker (metrics-worker.ts)
This worker runs after a scene is marked "complete" to update the global project dashboard.
TypeScript

import { db } from "./db";
import { projects, scenes } from "./schema";
import { eq } from "drizzle-orm";
import { updateWorkflowMetrics } from "./metrics-service";

export async function aggregateProjectPerformance(projectId: string) {
  // 1. Fetch project and all its completed scenes
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId)
  });

  const completedScenes = await db.query.scenes.findMany({
    where: eq(scenes.projectId, projectId)
  });

  // 2. Extract data for the most recent completion
  const lastScene = completedScenes[completedScenes.length - 1];
  
  // Find the 'best' version score from AssetRegistry
  const bestVersion = lastScene.assets.scene_video?.versions.find(
    v => v.version === lastScene.assets.scene_video?.best
  );
  
  const sceneMetric = {
    sceneId: lastScene.id,
    attempts: lastScene.assets.scene_video?.head ?? 1,
    bestAttempt: lastScene.assets.scene_video?.best ?? 1,
    finalScore: bestVersion?.metadata?.evaluation?.scores?.narrativeFidelity?.weight ?? 0,
    duration: lastScene.endTime - lastScene.startTime,
    ruleAdded: !!bestVersion?.metadata?.evaluation?.ruleSuggestion
  };

  // 3. Update the JSONB Metrics blob
  const updatedMetrics = updateWorkflowMetrics(project.metrics, sceneMetric);

  // 4. Persist back to Project
  await db.update(projects)
    .set({ 
      metrics: updatedMetrics,
      updatedAt: new Date() 
    })
    .where(eq(projects.id, projectId));
}

3. Business Value of this Data Model
	•	Bottleneck Detection: If attemptTrendSlope is positive, your AI Director is struggling to communicate with the Video Worker. The system identifies this before you waste GPU credits.
	•	Rule Validation: By tracking ruleAdded: true, you can see if global rules actually result in higher finalScore in subsequent scenes.
	•	Cost Forecasting: Knowing the averageAttempts allows you to predict the remaining budget required to finish the project based on the number of remaining scenes.



🏗️ Phase 1: Persistence & Type Foundations
Purpose: Establish the source of truth and the bridge between relational storage and AI-ready schemas.
	1	[Task] Implement Core Drizzle Schema: Create schema.ts using the provided logic.
	◦	Persistent Entities: projects, scenes, characters, locations, and jobs.
	◦	Purpose: Ensure all AI-generated specs (Lighting, Cinematography) are stored in jsonb fields to support evolving AI capabilities without frequent migrations.
	2	[Task] Create Zod-Drizzle Utilities: * Purpose: Bridge the "Any/Unknown" nature of JSONB columns to strict Zod schemas.
	◦	Instruction: Use createSelectSchema and createInsertSchema. Manually override JSONB fields with their respective Zod counterparts (e.g., LightingSchema, AssetRegistrySchema).
	3	[Task] Derived Types Export: * Instruction: Export TypeScript types from these schemas (e.g., export type ProjectEntity = z.infer<typeof DbProjectSchema>). These will be the primary types for the application layer.

🚀 Phase 2: Command & Workflow State
Purpose: Handle real-time user intent and track the transient state of the production pipeline.
	4	[Task] Command Dispatcher implementation:
	◦	Purpose: Act as an atomic gatekeeper for project changes.
	◦	Instruction: Implement a handler for UPDATE_SCENE_ASSET and REGENERATE_SCENE. It must use Drizzle transactions (tx) to ensure that if a version update fails, the updatedAt timestamp and state remain unchanged.
	5	[Task] Workflow State Tracking:
	◦	Purpose: Manage transient execution data (active Job IDs, error logs).
	◦	Instruction: Ensure the projects table tracks currentSceneIndex and forceRegenerateSceneIds. Implement an "Interrupt" system where the dispatcher can pause execution if a critical failure occurs.

🎬 Phase 3: Generative Worker Logic
Purpose: Transform high-level cinematic intent into technical visual prompts for video models.
	6	[Task] Prompt Engineering Engine:
	◦	Purpose: Translate the Gaffer, Director, and Cinematographer specs into a single string.
	◦	Instruction: Create a buildCinematicPrompt utility. It must combine:
	▪	ShotType + CameraMovement (Cinematography)
	▪	Hardness + MotivatedSources (Lighting)
	▪	PhysicalTraits (Character)
	7	[Task] Scene Video Worker:
	◦	Purpose: Background processing of generation jobs.
	◦	Instruction: Implement a loop that polls the jobs table for CREATED states. It must:
	1	Fetch the full scene/location/character context.
	2	Call the video API.
	3	Push the result to the Asset Registry.

🔍 Phase 4: Quality Control & Asset Versioning
Purpose: Automated validation and management of the "Studio's" output.
	8	[Task] Asset Registry Logic:
	◦	Purpose: Maintain an immutable history of every generation attempt.
	◦	Instruction: Update the assets JSONB field. Every new video must be an AssetVersion in a history array. Maintain a head (latest) and best (QC-approved) pointer.
	9	[Task] QC Supervisor Worker:
	◦	Purpose: Grade the video against the original specifications.
	◦	Instruction: Implement a worker that consumes completed generation jobs. It must:
	▪	Use the QualityEvaluationSchema to score the output.
	▪	Determine if a scene needs automatic regeneration based on the failThreshold.
	▪	Save promptCorrections back to the asset metadata for the next attempt.

📈 Phase 5: Metrics & Production Intelligence
Purpose: Analyze systemic performance to optimize future AI generations.
	10	[Task] Metrics Aggregator:
	◦	Purpose: Calculate the "learning curve" of the AI project.
	◦	Instruction: Implement the RegressionState update logic. For every completed scene:
	▪	Update the sum of squares for quality scores and attempts.
	▪	Calculate the Trend slope.
	▪	Store the result in the Project metrics field.
	11	[Task] Regression Analysis Utility:
	◦	Instruction: Create a utility that reads trendHistory and predicts the "Total Estimated Attempts" for the remainder of the project.

Source of Truth: All updates to scenes.assets must be additive (append to versions array).
Type Safety: Use DbSceneSchema.parse() to validate data coming out of the DB.

