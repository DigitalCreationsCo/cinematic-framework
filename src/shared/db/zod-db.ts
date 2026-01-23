import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import * as dbSchema from "./schema";
import {
  ProjectMetadata,
  WorkflowMetrics,
  AssetRegistry,
  Cinematography,
  Lighting,
  PhysicalTraits,
  CharacterState,
  LocationState,
  Location,
  Scene
} from "../types/workflow.types";

// --- PROJECT HELPERS ---
export const DbProjectSchema = createSelectSchema(dbSchema.projects);

export const InsertProject = createInsertSchema(dbSchema.projects, {
  metadata: ProjectMetadata,
  metrics: WorkflowMetrics,
  assets: AssetRegistry,
});

// --- SCENE HELPERS ---
export const DbSceneSchema = createSelectSchema(dbSchema.scenes, {
  cinematography: Cinematography,
  lighting: Lighting,
  assets: AssetRegistry,
});

export const InsertScene = createInsertSchema(dbSchema.scenes, {
  cinematography: Cinematography,
  lighting: Lighting,
  assets: AssetRegistry,
});

// --- CHARACTER & LOCATION HELPERS ---
export const DbCharacterSchema = createSelectSchema(dbSchema.characters);

export const InsertCharacter = createInsertSchema(dbSchema.characters, {
  physicalTraits: PhysicalTraits,
  state: CharacterState,
  assets: AssetRegistry,
});

export const DbLocationSchema = createSelectSchema(dbSchema.locations);

export const InsertLocation = createInsertSchema(dbSchema.locations, {
  lightingConditions: Lighting,
  state: LocationState,
  assets: AssetRegistry,
});

// --- JOB HELPERS ---
export const DbJobSchema = createSelectSchema(dbSchema.jobs);
export const InsertJob = createInsertSchema(dbSchema.jobs);

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
