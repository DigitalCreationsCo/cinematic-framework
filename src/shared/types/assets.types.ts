// shared/types/assets.types.ts
import { z } from "zod";
import { QualityEvaluationResult } from "./quality.types.js";

// ============================================================================
// ASSET STATUS & ENUMS
// ============================================================================

export const AssetStatus = z.preprocess(
  (val) => (typeof val === "string" ? val.toLowerCase() : val), z.enum([ "pending", "generating", "evaluating", "complete", "error" ])).default("pending");
export type AssetStatus = z.infer<typeof AssetStatus>;

// ============================================================================
// ASSET TYPES
// ============================================================================

export const GcsObjectType = z.union([
  z.literal('final_output'),
  z.literal('character_image'),
  z.literal('location_image'),
  z.literal('scene_video'),
  z.literal('scene_start_frame'),
  z.literal('scene_end_frame'),
  z.literal('render_video'),
  z.literal('composite_frame'),
]);
export type GcsObjectType = z.infer<typeof GcsObjectType>;

export const AssetKey = z.union([
  GcsObjectType,
  z.literal('enhanced_prompt'),
  z.literal('storyboard'),
  z.literal('scenes'),
  z.literal('character_description'),
  z.literal('character_prompt'),
  z.literal('location_description'),
  z.literal('location_prompt'),
  z.literal('scene_description'),
  z.literal('scene_prompt'),
  z.literal('start_frame_prompt'),
  z.literal('end_frame_prompt'),
  z.literal('scene_quality_evaluation'),
  z.literal('frame_quality_evaluation'),
  z.literal('audio_analysis'),
  z.literal('generation_rules'),
]);
export type AssetKey = z.infer<typeof AssetKey>;

export const AssetType = z.enum([ 'video', 'image', 'audio', 'text', 'json' ]);
export type AssetType = z.infer<typeof AssetType>;

export type Scope = {
  projectId: string;
} | {
  projectId: string;
  sceneId: string;
} | {
  projectId: string;
  characterIds: string[];
} | {
  projectId: string;
  locationIds: string[];
};

// ============================================================================
// ASSET VERSION & REGISTRY
// ============================================================================

export const AssetVersion = z.object({
  version: z.number(),
  data: z.string().describe("The content (text) or URI (file)"),
  type: AssetType,

  metadata: z.object({
    evaluation: QualityEvaluationResult.optional().describe("Quality evaluation result").nullable(),
    model: z.string().nonoptional().describe("AI model used for asset generation"),
    jobId: z.string().describe("Job that created this version"),
    prompt: z.string().optional().describe("Prompt used for asset generation"),
  }).catchall(z.any()).describe("Flexible metadata for evaluations, models, etc."),

  createdAt: z.preprocess(
    (val) => (typeof val === "string" ? new Date(val) : val),
    z.date()
  ).default(() => new Date()),
});
export type AssetVersion = z.infer<typeof AssetVersion>;


export const AssetHistory = z.object({
  head: z.number().default(0).describe("The highest version number created"),
  best: z.number().default(0).describe("The version currently selected as active/best"),
  versions: z.array(AssetVersion).default([]),
});
export type AssetHistory = z.infer<typeof AssetHistory>;

export const AssetRegistry = z.partialRecord(AssetKey, AssetHistory).describe("The core registry map to be used in Projects, Scenes, Locations, and Characters").default({});
export type AssetRegistry = z.infer<typeof AssetRegistry>;

export type CreateVersionedAssetsBaseArgs = [
  scope: Scope,
  assetKey: AssetKey,

  // Now accepts a single type string OR an array of strings
  type: AssetType | AssetType[],

  // The primary data payload (Always an array)
  dataList: string[],

  // Now accepts single metadata object OR array of objects
  metadata: AssetVersion[ 'metadata' ] | AssetVersion[ 'metadata' ][],

  // Now accepts single boolean OR array of booleans
  setBest?: boolean | boolean[],
];
