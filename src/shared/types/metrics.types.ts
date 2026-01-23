import { z } from "zod";
import { PromptCorrection, QualityEvaluationResult } from "./quality.types";



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


// ============================================================================
// ASSET VERSIONING SCHEMA
// ============================================================================

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


export const AssetVersion = z.object({
  version: z.number(),
  data: z.string().describe("The content (text) or URI (file)"),
  type: AssetType,
  createdAt: z.date()
    .default(() => new Date()),
  metadata: z.object({
    evaluation: QualityEvaluationResult.optional().describe("Quality evaluation result").nullable(),
    model: z.string().nonoptional().describe("AI model used for asset generation"),
    jobId: z.string().describe("Job that created this version"),
    prompt: z.string().optional().describe("Prompt used for asset generation"),
  }).catchall(z.any()).describe("Flexible metadata for evaluations, models, etc."),
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


// ============================================================================
// PIPELINE METRICS SCHEMA (Production Tracking)
// ============================================================================

export const SceneGenerationMetrics = z.array(z.object({
  sceneId: z.string(),
  attempts: z.number(),
  bestAttempt: z.number(),
  finalScore: z.number(),
  duration: z.number(),
  ruleAdded: z.array(z.string()),
}));
export type SceneGenerationMetrics = z.infer<typeof SceneGenerationMetrics>;


export const VersionMetric = z.object({
  assetKey: AssetKey,
  attemptNumber: z.number().describe("Job attempt (1, 2, 3...)"),
  assetVersion: z.number().describe("Which version was created"),
  finalScore: z.number().describe("Final quality score"),
  jobId: z.string().describe("Link to specific job"),
  startTime: z.number().describe("Start time of the job attempt"),
  endTime: z.number().describe("End time of the job attempt"),
  attemptDuration: z.number().describe("Duration of the job attempt"),
  ruleAdded: z.array(z.string()).describe("Rules added to the job"),
  corrections: z.array(PromptCorrection).describe("Corrections made to the prompt"),
});
export type VersionMetric = z.infer<typeof VersionMetric>;


export const Trend = z.object({
  averageAttempts: z.number().describe("Average number of attempts per asset"),
  attemptTrendSlope: z.number().describe("Slope of the attempt trend"),
  qualityTrendSlope: z.number().describe("Slope of the quality trend"),
});
export type Trend = z.infer<typeof Trend>;


export const RegressionState = z.object({
  count: z.number(),
  sumX: z.number(),
  sumY_a: z.number(),
  sumY_q: z.number(),
  sumXY_a: z.number(),
  sumXY_q: z.number(),
  sumX2: z.number(),
});
export type RegressionState = z.infer<typeof RegressionState>;


export const WorkflowMetrics = z.object({
  sceneMetrics: z.record(z.uuid({ "version": "v7" }), SceneGenerationMetrics).default({}).describe("Production metrics for scene generation"),
  versionMetrics: z.partialRecord(AssetKey, z.array(VersionMetric).default([]))
    .refine((val) => Object.keys(val).every((key) => AssetKey.safeParse(key).success), { message: "Invalid AssetKey used in versionMetrics" })
    .default({}).describe("Production metrics for asset generation"),
  trendHistory: z.array(Trend).default([]).describe("Production metrics for trend analysis"),
  regression: RegressionState.default({
    count: 0,
    sumX: 0,
    sumY_a: 0,
    sumY_q: 0,
    sumXY_a: 0,
    sumXY_q: 0,
    sumX2: 0,
  }).describe("Production metrics for regression analysis"),
  globalTrend: Trend.optional().describe("Production metrics for global trend analysis"),
}).catchall(z.any())
  .describe("Production metrics");
export type WorkflowMetrics = z.infer<typeof WorkflowMetrics>;


/**
 * Default WorkflowMetrics factory for project creation.
 */
export const createDefaultMetrics = (): z.infer<typeof WorkflowMetrics> =>
  WorkflowMetrics.parse({});