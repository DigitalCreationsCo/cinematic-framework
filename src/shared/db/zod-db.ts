import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import * as dbSchema from "./schema.js";
import {
  ProjectMetadata,
  AssetRegistry,
  Cinematography,
  Lighting,
  PhysicalTraits,
  CharacterState,
  LocationState,
  AudioAnalysisAttributes,
  GenerationRules,
  WorkflowMetrics,
  Project,
  Storyboard,
  SceneStatus,
  SceneAttributes,
  CharacterAttributes,
  LocationAttributes,
  AssetStatus,
} from "../types/workflow.types.js";
import { InsertIdentityBase, ProjectRef } from "../types/identity.types.js";



export const DbSceneSchema = createSelectSchema(dbSchema.scenes, {
  ...Cinematography.shape,
  lighting: Lighting,
  assets: AssetRegistry,
});

export const InsertScene = createInsertSchema(dbSchema.scenes, {
  ...InsertIdentityBase.shape,
  ...ProjectRef.shape,
  ...SceneAttributes.omit({ characters: true }).shape,
  ...SceneStatus.shape,
  assets: AssetRegistry.default(() => (AssetRegistry.parse({}))),
});
export type InsertScene = z.infer<typeof InsertScene>;

// --- CHARACTER & LOCATION HELPERS ---
export const DbCharacterSchema = createSelectSchema(dbSchema.characters, {
  assets: AssetRegistry,
});

export const InsertCharacter = createInsertSchema(dbSchema.characters, {
  ...InsertIdentityBase.shape,
  ...ProjectRef.shape,
  ...CharacterAttributes.shape,
  assets: AssetRegistry.default(() => (AssetRegistry.parse({}))),
});
export type InsertCharacter = z.infer<typeof InsertCharacter>;

export const DbLocationSchema = createSelectSchema(dbSchema.locations, {
  assets: AssetRegistry,
});

export const InsertLocation = createInsertSchema(dbSchema.locations, {
  ...InsertIdentityBase.shape,
  ...ProjectRef.shape,
  ...LocationAttributes.shape,
  assets: AssetRegistry.default(() => (AssetRegistry.parse({}))),
});
export type InsertLocation = z.infer<typeof InsertLocation>;

// --- PROJECT HELPERS ---
export const DbProjectSchema = createSelectSchema(dbSchema.projects, {
  storyboard: Storyboard,
  audioAnalysis: AudioAnalysisAttributes.nullish(),
  assets: AssetRegistry,
  forceRegenerateSceneIds: z.array(z.string()).default([]),
  generationRules: GenerationRules.default([]),
  generationRulesHistory: z.preprocess((val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") { try { return JSON.parse(val); } catch { return []; } }
    return [];
  }, z.array(GenerationRules)).default([]),
});

export const InsertProject = createInsertSchema(dbSchema.projects, {
  ...InsertIdentityBase.shape,
  storyboard: z.object({
    metadata: ProjectMetadata,
    scenes: z.array(InsertScene),
    characters: z.array(InsertCharacter),
    locations: z.array(InsertLocation),
  }).readonly(),
  metadata: ProjectMetadata.default(() => (ProjectMetadata.parse({}))),
  metrics: WorkflowMetrics.default(() => (WorkflowMetrics.parse({}))),
  assets: AssetRegistry.default(() => (AssetRegistry.parse({}))),
  audioAnalysis: AudioAnalysisAttributes.nullish(),
  status: AssetStatus.default("pending"),
  currentSceneIndex: z.number().default(0).describe("Index of scene currently being processed"),
  forceRegenerateSceneIds: z.array(z.string()).default([]).describe("List of scene IDs to force video regenerate"),
  generationRules: GenerationRules.default([]),
  generationRulesHistory: z.array(GenerationRules).default([]),
}).extend({
  scenes: z.array(InsertScene).default([]),
  characters: z.array(InsertCharacter).default([]),
  locations: z.array(InsertLocation).default([]),
});
export type InsertProject = z.infer<typeof InsertProject>;


// --- JOB HELPERS ---
export const DbJobSchema = createSelectSchema(dbSchema.jobs);
export const InsertJob = createInsertSchema(dbSchema.jobs, {
  ...InsertIdentityBase.shape,
});
export type InsertJob = z.infer<typeof InsertJob>;

// --- Derived Types ---
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
