import {
  pgTable, uuid, text, timestamp, integer,
  jsonb, real, pgEnum,
  index
} from "drizzle-orm/pg-core";
import {
  InitialProjectMetadata, AssetRegistry, Lighting, Cinematography,
  CharacterState, LocationState, PhysicalTraits, WorkflowMetrics,
  AudioAnalysis,
  InitialStoryboard,
} from "./types/workflow.types";
import { v7 as uuidv7 } from "uuid"; 
import { sql } from "drizzle-orm";

// --- ENUMS ---
export const assetStatusEnum = pgEnum("asset_status", [ "pending", "generating", "evaluating", "complete", "error" ]);
export const jobStateEnum = pgEnum("job_state", [ "CREATED", "RUNNING", "COMPLETED", "FAILED", "FATAL", "CANCELLED" ]);

export const users = pgTable("users", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

export type InsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// --- TABLES ---

export const projects = pgTable("projects", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  // Core Data - uses loose types for insertion flexibility
  storyboard: jsonb("storyboard").$type<InitialStoryboard>().notNull(),
  metadata: jsonb("metadata").$type<InitialProjectMetadata>().notNull(),

  // Workflow Control
  status: assetStatusEnum("status").default("pending").notNull(),
  currentSceneIndex: integer("current_scene_index").default(0).notNull(),
  forceRegenerateSceneIds: text("force_regenerate_scene_ids").array().default([]).notNull(),

  assets: jsonb("assets").$type<AssetRegistry>().default({}).notNull(),
  generationRules: text("generation_rules").array().default([]).notNull(),
  generationRulesHistory: text("generation_rules_history").array().array().default([]).notNull(),

  metrics: jsonb("metrics").$type<WorkflowMetrics>().default({
    sceneMetrics: [],
    attemptMetrics: [],
    trendHistory: [],
    regression: {
      count: 0,
      sumX: 0,
      sumY_a: 0,
      sumY_q: 0,
      sumXY_a: 0,
      sumXY_q: 0,
      sumX2: 0,
    },
  }).notNull(),
  audioAnalysis: jsonb("audio_analysis").$type<AudioAnalysis>(),
});

export const characters = pgTable("characters", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  referenceId: text("reference_id").notNull(), // e.g. char_1
  name: text("name").notNull(),
  aliases: text("aliases").array().default([]).notNull(),
  age: text("age").notNull(),

  physicalTraits: jsonb("physical_traits").$type<PhysicalTraits>().notNull(),
  appearanceNotes: jsonb("appearance_notes").$type<string[]>().notNull(),
  assets: jsonb("assets").$type<AssetRegistry>().default({}).notNull(),
  state: jsonb("state").$type<CharacterState>(),
});

export const locations = pgTable("locations", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  referenceId: text("reference_id").notNull(), // e.g. loc_1
  name: text("name").notNull(),

  lightingConditions: jsonb("lighting_conditions").$type<Lighting>().notNull(),
  timeOfDay: text("time_of_day").notNull(),
  weather: text("weather").notNull(),
  colorPalette: jsonb("color_palette").$type<string[]>().notNull(),
  mood: text("mood").notNull(),
  
  architecture: text("architecture").notNull(),
  naturalElements: jsonb("natural_elements").$type<string[]>().notNull(),
  manMadeObjects: jsonb("man_made_objects").$type<string[]>().notNull(),
  groundSurface: text("ground_surface").notNull(),
  skyOrCeiling: text("sky_or_ceiling").notNull(),

  assets: jsonb("assets").$type<AssetRegistry>().default({}).notNull(),
  state: jsonb("state").$type<LocationState>(),
});

export const scenes = pgTable("scenes", {
  id: uuid("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  id: text("id").notNull().primaryKey().$defaultFn(() => uuidv7()),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(), // JobType
  state: jobStateEnum("state").default("CREATED").notNull(),
  payload: jsonb("payload"),
  result: jsonb("result"),
  error: text("error"),
  attempt: integer("attempt").default(1).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({

  // Optimization: Fast counting of running jobs per project
  // 'claimJob' concurrency check 
  projectStateIdx: index("idx_project_running_jobs").on(table.projectId).where(sql`state = 'RUNNING'`),

  // Composite index for general lookups
  projectCreatedIdx: index("idx_project_created").on(table.projectId, table.state),

  // Fast recovery of stale jobs
  stateIdx: index("idx_jobs_state_updated").on(table.state, table.updatedAt),
}));
