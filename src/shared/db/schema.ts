import {
  pgTable, uuid, text, timestamp, integer,
  jsonb, real, 
  index, uniqueIndex,
  primaryKey
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { sql } from "drizzle-orm";
import { JobState, JobType } from "../types/job.types.js";
import { ProjectMetadata } from "../types/metadata.types.js";
import { AssetRegistry } from "../types/assets.types.js";
import { CharacterState } from "../types/character.types.js";
import { LocationState } from "../types/location.types.js";
import { createDefaultMetrics, WorkflowMetrics } from "../types/metrics.types.js";
import { Lighting, Composition, TransitionType, ShotType, CameraAngle, CameraMovement } from "../types/cinematography.types.js";
import { PhysicalTraits } from "../types/character.types.js";
import { AudioAnalysisAttributes } from "../types/audio.types.js";
import { AssetKey, AssetStatus } from "../types/assets.types.js";
import { Storyboard } from "../types/workflow.types.js";

// --- TABLES ---
export const users = pgTable("users", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

export const projects = pgTable("projects", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  storyboard: jsonb("storyboard").$type<Storyboard>().notNull(),
  metadata: jsonb("metadata").$type<ProjectMetadata>().notNull(),
  audioAnalysis: jsonb("audio_analysis").$type<AudioAnalysisAttributes>(),
  status: text("status").$type<AssetStatus>().default("pending").notNull(),
  metrics: jsonb("metrics").$type<WorkflowMetrics>().default(createDefaultMetrics()).notNull(),
  assets: jsonb("assets").$type<AssetRegistry>().default({}).notNull(),
  currentSceneIndex: integer("current_scene_index").default(0).notNull(),
  forceRegenerateSceneIds: text("force_regenerate_scene_ids").array().default([]).notNull(),
  generationRules: text("generation_rules").array().default([]).notNull(),
  generationRulesHistory: jsonb("generation_rules_history").$type<string[][]>().default([]).notNull(),
});

export const characters = pgTable("characters", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  referenceId: text("reference_id").notNull(), 
  name: text("name").notNull(),
  aliases: text("aliases").array().default([]).notNull(),
  age: text("age").notNull(),
  physicalTraits: jsonb("physical_traits").$type<PhysicalTraits>().notNull(),
  appearanceNotes: jsonb("appearance_notes").$type<string[]>().notNull(),
  assets: jsonb("assets").$type<AssetRegistry>().default({}).notNull(),
  state: jsonb("state").$type<CharacterState>().notNull(),
});

export const scenes = pgTable("scenes", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  sceneIndex: integer("scene_index").notNull(),
  // Narrative & Sync
  description: text("description").notNull(),
  startTime: real("start_time").notNull(),
  endTime: real("end_time").notNull(),
  duration: real("duration").notNull(),
  type: text("type").notNull(),
  lyrics: text("lyrics"),
  musicalDescription: text("musical_description"),
  musicChange: text("music_change"),
  intensity: text("intensity"),
  mood: text("mood").notNull(),
  tempo: text("tempo").notNull(),
  audioEvidence: text("audio_evidence").notNull(),
  transientImpact: text("transient_impact").notNull(),
  audioSync: text("audio_sync").notNull(),
  // Cinematic Specs
  transitionType: text("transition_type").$type<TransitionType>().notNull(),
  shotType: text("shot_type").$type<ShotType>().notNull(),
  cameraAngle: text("camera_angle").$type<CameraAngle>().notNull(),
  cameraMovement: text("camera_movement").$type<CameraMovement>().notNull(),
  composition: jsonb("composition").$type<Composition>().notNull(),
  lighting: jsonb("lighting").$type<Lighting>().notNull(),
  // Script Supervisor Links
  continuityNotes: text("continuity_notes").array().default([]),
  locationReferenceId: text("location_reference_id").notNull(),
  locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
  // Persistent Results
  status: text("status").$type<AssetStatus>().default("pending"),
  progressMessage: text("progress_message"),
  assets: jsonb("assets").$type<AssetRegistry>().default({}),
});

export const locations = pgTable("locations", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  referenceId: text("reference_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  mood: text("mood").notNull(),
  lightingConditions: jsonb("lighting_conditions").$type<Lighting>().notNull(),
  timeOfDay: text("time_of_day").notNull(),
  weather: text("weather").notNull(),
  colorPalette: jsonb("color_palette").$type<string[]>().notNull(),
  architecture: jsonb("architecture").$type<string[]>().notNull(),
  naturalElements: jsonb("natural_elements").$type<string[]>().notNull(),
  manMadeObjects: jsonb("man_made_objects").$type<string[]>().notNull(),
  groundSurface: text("ground_surface").notNull(),
  skyOrCeiling: text("sky_or_ceiling").notNull(),
  assets: jsonb("assets").$type<AssetRegistry>().default({}).notNull(),
  state: jsonb("state").$type<LocationState>().notNull(),
});

export const jobs = pgTable("jobs", {
  id: text("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  type: text("type").$type<JobType>().notNull(),
  state: text("state").$type<JobState>().default("CREATED").notNull(),
  payload: jsonb("payload"),
  result: jsonb("result"),
  error: text("error"),
  uniqueKey: text("unique_key"),
  assetKey: text("asset_key").$type<AssetKey>(),
  attempt: integer("attempt").default(1).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({

  // 1. Versioning & Reset Protection: Only one ACTIVE job per logical task.
  // This allows "move through" failures by inserting a fresh record 
  // once the old one is FAILED or CANCELLED, while preventing double-starts.
  activeLogicalJobIdx: uniqueIndex("idx_active_logical_job")
    .on(table.projectId, table.type, table.uniqueKey)
    .where(sql`state IN ('CREATED', 'RUNNING')`),

  // 2. Maximum Performance: Fast 'Latest Job' lookup
  // Supports Index-Only scans for the core business query
  scopedLatestIdx: index("idx_scoped_latest_job").on(
    table.projectId,
    table.type,
    table.uniqueKey,
    table.createdAt.desc()
  ),

  // 2. Concurrency Optimization: Fast counting of running jobs per project
  // Partial index ensures we only scan records that matter for 'claimJob'
  projectStateIdx: index("idx_project_running_jobs")
    .on(table.projectId)
    .where(sql`state = 'RUNNING'`),

  // 3. Operational: Composite index for general lookups
  projectCreatedIdx: index("idx_project_created").on(table.projectId, table.state),

  // 4. Monitoring: Fast recovery of stale jobs
  stateIdx: index("idx_jobs_state_updated").on(table.state, table.updatedAt),
}));

export const scenesToCharacters = pgTable("scenes_to_characters", {
  sceneId: uuid("scene_id")
    .notNull()
    .references(() => scenes.id, { onDelete: "cascade" }),
  characterId: uuid("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
}, (t) => ([ primaryKey({ columns: [ t.sceneId, t.characterId ] }) ])
);