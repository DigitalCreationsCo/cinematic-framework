// shared/types/entities.types.ts
import { z } from "zod";
import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import * as schema from "../db/schema.js";
import { IdentityBase, InsertIdentityBase, ProjectRef } from "./base.types.js";
import { Lighting } from "./cinematography.types.js";
import { CharacterAttributes } from "./character.types.js";
import { LocationAttributes, } from "./location.types.js";
import { SceneAttributes, SceneStatus, ScriptSupervisorScene } from "./scene.types.js";
import { JOB_STATES, JOB_TYPES } from "./job.types.js";
import { AssetRegistry, AssetStatus } from "./assets.types.js";
import { ProjectMetadata } from "./metadata.types.js";
import { AudioAnalysisAttributes } from "./audio.types.js";
import { WorkflowMetrics } from "./metrics.types.js";
import { Character, Location, Scene, Storyboard } from "./workflow.types.js";

// ============================================================================
// SCENE ENTITY
// ============================================================================

export const SceneEntity = createSelectSchema(schema.scenes, {
  ...IdentityBase.shape,
  ...ProjectRef.shape,
  ...SceneAttributes.omit({ characterReferenceIds: true }).shape,
  ...ScriptSupervisorScene.pick({ locationId: true }).shape,
  ...SceneStatus.shape,
  lighting: Lighting,
  assets: AssetRegistry,
});
export type SceneEntity = z.infer<typeof SceneEntity>;

// ============================================================================
// INSERT ENTITIES
// ============================================================================

export const InsertScene = createInsertSchema(schema.scenes, {
  ...InsertIdentityBase.shape,
  ...ProjectRef.shape,
  ...SceneAttributes.omit({ characterReferenceIds: true }).shape,
  ...ScriptSupervisorScene.pick({ locationId: true }).shape,
  ...SceneStatus.shape,
  assets: AssetRegistry.default(() => (AssetRegistry.parse({}))),
});
export type InsertScene = z.infer<typeof InsertScene>;

export const InsertCharacter = createInsertSchema(schema.characters, {
  ...InsertIdentityBase.shape,
  ...ProjectRef.shape,
  ...CharacterAttributes.shape,
  assets: AssetRegistry.default(() => (AssetRegistry.parse({}))),
});
export type InsertCharacter = z.infer<typeof InsertCharacter>;

export const InsertLocation = createInsertSchema(schema.locations, {
  ...InsertIdentityBase.shape,
  ...ProjectRef.shape,
  ...LocationAttributes.shape,
  assets: AssetRegistry.default(() => (AssetRegistry.parse({}))),
});
export type InsertLocation = z.infer<typeof InsertLocation>;

// ============================================================================
// JOB ENTITY
// ============================================================================

export const Job = createSelectSchema(schema.jobs, {
  ...IdentityBase.shape,
  state: z.enum(JOB_STATES),
  type: z.enum(JOB_TYPES),
  payload: z.record(z.any(), z.any()).nullish(),
  result: z.record(z.any(), z.any()).nullish(),
});
export type Job = z.infer<typeof Job>;

export const InsertJob = createInsertSchema(schema.jobs, {
  ...InsertIdentityBase.shape,
  state: z.enum(JOB_STATES),
  type: z.enum(JOB_TYPES),
  payload: z.record(z.any(), z.any()).nullish(),
  result: z.record(z.any(), z.any()).nullish(),
});
export type InsertJob = z.infer<typeof InsertJob>;

// ============================================================================
// JUNCTION TABLE
// ============================================================================

export const DbScenesToCharactersSchema = createSelectSchema(schema.scenesToCharacters);
export type DbScenesToCharacters = z.infer<typeof DbScenesToCharactersSchema>;

// ============================================================================
// GENERATION RULES
// ============================================================================

export const GenerationRules = z.array(z.string()).default([]).describe("Generation rule guidelines");
export type GenerationRules = z.infer<typeof GenerationRules>;

// ============================================================================
// PROJECT ENTITY
// ============================================================================

export const ProjectEntity = createSelectSchema(schema.projects, {
  ...IdentityBase.shape,
  storyboard: Storyboard.readonly().describe("The immutable storyboard snapshot"),
  metadata: ProjectMetadata.describe("Fully populated production metadata"),
  audioAnalysis: AudioAnalysisAttributes.nullish(),
  metrics: WorkflowMetrics,
  assets: AssetRegistry,
  generationRules: GenerationRules,
  generationRulesHistory: z.preprocess((val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") { try { return JSON.parse(val); } catch { return []; } }
    return [];
  }, z.array(GenerationRules)),

  currentSceneIndex: z.number().default(0).describe("The index of the current scene in the storyboard"),
  status: AssetStatus,
  forceRegenerateSceneIds: z.array(z.string()).default([]).describe("List of scene IDs to force video regenerate"),
});
export type ProjectEntity = z.infer<typeof ProjectEntity>;

// ============================================================================
// PROJECT (Application Runtime Schema)
// ============================================================================

export const Project = ProjectEntity.extend({
  scenes: z.array(Scene).default([]),
  characters: z.array(Character).default([]),
  locations: z.array(Location).default([]),
});
export type Project = z.infer<typeof Project>;

// ============================================================================
// INSERT PROJECT
// ============================================================================

export const InsertProject = createInsertSchema(schema.projects, {
  ...InsertIdentityBase.shape,
  // JSONB Overrides
  storyboard: z.object({
    metadata: ProjectMetadata,
    scenes: z.array(InsertScene),
    characters: z.array(InsertCharacter),
    locations: z.array(InsertLocation),
  }).readonly().describe("The immutable storyboard snapshot"),
  metadata: ProjectMetadata.default(() => (ProjectMetadata.parse({}))),
  metrics: WorkflowMetrics.default(() => (WorkflowMetrics.parse({}))),
  assets: AssetRegistry.default(() => (AssetRegistry.parse({}))),
  audioAnalysis: AudioAnalysisAttributes.nullish(),

  status: AssetStatus.default("pending"),
  currentSceneIndex: z.number().default(0).describe("Index of scene currently being processed"),
  forceRegenerateSceneIds: z.array(z.string()).default([]).describe("List of scene IDs to force video regenerate"),
  generationRules: GenerationRules.default([]),
  generationRulesHistory: z.preprocess((val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") { try { return JSON.parse(val); } catch { return []; } }
    return [];
  }, z.array(GenerationRules)).default([]).describe("history of generation rule guidelines"),
}).extend({
  scenes: z.array(InsertScene).default([]),
  characters: z.array(InsertCharacter).default([]),
  locations: z.array(InsertLocation).default([]),
});
export type InsertProject = z.infer<typeof InsertProject>;