import {
  pgTable, uuid, text, timestamp, integer,
  jsonb, boolean, real, pgEnum
} from "drizzle-orm/pg-core";
import {
  ProjectMetadata, AssetRegistry, Lighting, Cinematography,
  CharacterState, LocationState, PhysicalTraits, WorkflowMetrics,
  AudioAnalysis,
  Storyboard
} from "./types/pipeline.types";
import { z } from "zod";
import { createTableFromZod } from "zod-to-drizzle";

// --- ENUMS ---
export const assetStatusEnum = pgEnum("asset_status", [ "pending", "generating", "evaluating", "complete", "error" ]);
export const jobStateEnum = pgEnum("job_state", [ "CREATED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED" ]);

// --- USERS (Preserved from original) ---
const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email().optional(),
  createdAt: z.string().default(new Date().toISOString()),
  updatedAt: z.string().default(new Date().toISOString()),
});

export const users = createTableFromZod("users", UserSchema, {
  dialect: "pg",
  primaryKey: "id"
});

export type InsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// --- TABLES ---

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  // Core Data
  storyboard: jsonb("storyboard").$type<Storyboard>().notNull(),
  metadata: jsonb("metadata").$type<ProjectMetadata>().notNull(),

  // Workflow Control
  status: assetStatusEnum("status").default("pending").notNull(),
  currentSceneIndex: integer("current_scene_index").default(0).notNull(),
  forceRegenerateSceneIds: text("force_regenerate_scene_ids").array().default([]).notNull(),

  assets: jsonb("assets").$type<AssetRegistry>().default({}).notNull(),
  generationRules: text("generation_rules").array().default([]).notNull(),
  generationRulesHistory: text("generation_rules_history").array().array().default([]).notNull(),

  metrics: jsonb("metrics").$type<WorkflowMetrics>(),
  audioAnalysis: jsonb("audio_analysis").$type<AudioAnalysis>(),
});

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  id: uuid("id").primaryKey().defaultRandom(),
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
  id: uuid("id").primaryKey().defaultRandom(),
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
