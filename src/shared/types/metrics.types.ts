import { z } from "zod";
import { QualityEvaluationResultSchema } from "./quality.types";



export const GcsObjectTypeSchema = z.union([
  z.literal('final_output'),
  z.literal('character_image'),
  z.literal('location_image'),
  z.literal('scene_video'),
  z.literal('scene_start_frame'),
  z.literal('scene_end_frame'),
  z.literal('render_video'),
  z.literal('composite_frame'),
]);
export type GcsObjectType = z.infer<typeof GcsObjectTypeSchema>;


// ============================================================================
// ASSET VERSIONING SCHEMA
// ============================================================================

export const AssetKeySchema = z.union([
  GcsObjectTypeSchema,
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
export type AssetKey = z.infer<typeof AssetKeySchema>;


export const AssetTypeSchema = z.enum([ 'video', 'image', 'audio', 'text', 'json' ]);
export type AssetType = z.infer<typeof AssetTypeSchema>;


export const AssetVersionSchema = z.object({
  version: z.number(),
  data: z.string().describe("The content (text) or URI (file)"),
  type: AssetTypeSchema,
  createdAt: z.string(),
  metadata: z.object({
    evaluation: QualityEvaluationResultSchema.optional().describe("Quality evaluation result").nullable(),
    model: z.string().nonoptional().describe("AI model used for asset generation"),
    jobId: z.string().describe("Job that created this version"),
    prompt: z.string().optional().describe("Prompt used for asset generation"),
  }).catchall(z.any()).describe("Flexible metadata for evaluations, models, etc."),
});
export type AssetVersion = z.infer<typeof AssetVersionSchema>;


export const AssetHistorySchema = z.object({
  head: z.number().default(0).describe("The highest version number created"),
  best: z.number().default(0).describe("The version currently selected as active/best"),
  versions: z.array(AssetVersionSchema).default([]),
});
export type AssetHistory = z.infer<typeof AssetHistorySchema>;


export const AssetRegistrySchema = z.partialRecord(AssetKeySchema, AssetHistorySchema).describe("The core registry map to be used in Projects, Scenes, Locations, and Characters").default({});
export type AssetRegistry = z.infer<typeof AssetRegistrySchema>;


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

export const SceneGenerationMetricsSchema = z.array(z.object({
  sceneId: z.string(),
  attempts: z.number(),
  bestAttempt: z.number(),
  finalScore: z.number(),
  duration: z.number(),
  ruleAdded: z.array(z.string()),
}));
export type SceneGenerationMetrics = z.infer<typeof SceneGenerationMetricsSchema>;


export const versionMetricSchema = z.object({
  sceneId: z.string().describe("Scene ID"),
  attemptNumber: z.number().describe("Job attempt (1, 2, 3...)"),
  assetVersion: z.number().describe("Which version was created"),
  finalScore: z.number().describe("Final quality score"),
  jobId: z.string().describe("Link to specific job"),
  jobDuration: z.number().optional().describe("Duration of the job"),
  ruleAdded: z.array(z.string()).describe("Rules added to the job"),
  corrections: z.array(z.string()).describe("Corrections made to the job"),
});
export type VersionMetric = z.infer<typeof versionMetricSchema>;


export const TrendSchema = z.object({
  averageAttempts: z.number().describe("Average number of attempts per asset"),
  attemptTrendSlope: z.number().describe("Slope of the attempt trend"),
  qualityTrendSlope: z.number().describe("Slope of the quality trend"),
});
export type Trend = z.infer<typeof TrendSchema>;


export const RegressionStateSchema = z.object({
  count: z.number(),
  sumX: z.number(),
  sumY_a: z.number(),
  sumY_q: z.number(),
  sumXY_a: z.number(),
  sumXY_q: z.number(),
  sumX2: z.number(),
});
export type RegressionState = z.infer<typeof RegressionStateSchema>;


export const WorkflowMetricsSchema = z.object({
  sceneMetrics: z.record(z.uuid({ "version": "v7" }), SceneGenerationMetricsSchema).default({}).describe("Production metrics for scene generation"),
  versionMetrics: z.record(AssetKeySchema, z.array(versionMetricSchema)).refine(
    (val) => Object.keys(val).every((key) => AssetKeySchema.safeParse(key).success),
    { message: "Invalid AssetKey used in versionMetrics" }
  ).default({} as any).describe("Production metrics for asset generation") as z.ZodType<Partial<Record<AssetKey, VersionMetric[]>>>,
  trendHistory: z.array(TrendSchema).default([]).describe("Production metrics for trend analysis"),
  regression: RegressionStateSchema.default({
    count: 0,
    sumX: 0,
    sumY_a: 0,
    sumY_q: 0,
    sumXY_a: 0,
    sumXY_q: 0,
    sumX2: 0,
  }).describe("Production metrics for regression analysis"),
  globalTrend: TrendSchema.optional().describe("Production metrics for global trend analysis"),
}).describe("Production metrics");
export type WorkflowMetrics = z.infer<typeof WorkflowMetricsSchema>;


/**
 * Default WorkflowMetrics factory for project creation.
 */
export const createDefaultMetrics = (): z.infer<typeof WorkflowMetricsSchema> =>
  WorkflowMetricsSchema.parse({});