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
  LocationStateSchema,
  InitialProjectSchema,
  LocationSchema
} from "./types/pipeline.types";

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
export const DbCharacterSchema = createSelectSchema(dbSchema.characters);

export const DbInsertCharacterSchema = createInsertSchema(dbSchema.characters, {
  physicalTraits: PhysicalTraitsSchema,
  state: CharacterStateSchema,
  assets: AssetRegistrySchema,
});

export const DbLocationSchema = createSelectSchema(dbSchema.locations);

export const DbInsertLocationSchema = createInsertSchema(dbSchema.locations, {
  lightingConditions: LightingSchema,
  state: LocationStateSchema,
  assets: AssetRegistrySchema,
});

// --- JOB HELPERS ---
export const DbJobSchema = createSelectSchema(dbSchema.jobs);
export const DbInsertJobSchema = createInsertSchema(dbSchema.jobs);

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
