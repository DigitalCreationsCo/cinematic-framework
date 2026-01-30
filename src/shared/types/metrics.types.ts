// shared/types/metrics.types.ts
import { z } from "zod";
import { AssetKey } from "./assets.types.js";
import { PromptCorrection, QualityEvaluationResult } from "./quality.types.js";



// ============================================================================
// WORKFLOW METRICS
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
})
  .catchall(z.any())
  .default((() => createDefaultMetrics()) as any)
  .describe("Production metrics");
export type WorkflowMetrics = z.infer<typeof WorkflowMetrics>;


/**
 * Default WorkflowMetrics factory for project creation.
 */
export const createDefaultMetrics = (): WorkflowMetrics => {
  return WorkflowMetrics.parse({});
};