import { z } from "zod";
// ============================================================================
// PIPELINE METRICS SCHEMA (Production Tracking)
// ============================================================================

export const SceneGenerationMetricSchema = z.object({
  sceneId: z.string(),
  attempts: z.number(),
  bestAttempt: z.number(),
  finalScore: z.number(),
  duration: z.number(),
  ruleAdded: z.boolean(),
});
export type SceneGenerationMetric = z.infer<typeof SceneGenerationMetricSchema>;


export const AttemptMetricSchema = z.object({
  sceneId: z.string(),
  attemptNumber: z.number(),
  finalScore: z.number(),
  duration: z.number().optional(),
});
export type AttemptMetric = z.infer<typeof AttemptMetricSchema>;


export const TrendSchema = z.object({
  averageAttempts: z.number(),
  attemptTrendSlope: z.number(),
  qualityTrendSlope: z.number(),
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
  sceneMetrics: z.array(SceneGenerationMetricSchema).default([]),
  attemptMetrics: z.array(AttemptMetricSchema).default([]),
  trendHistory: z.array(TrendSchema).default([]),
  regression: RegressionStateSchema.default({
    count: 0,
    sumX: 0,
    sumY_a: 0,
    sumY_q: 0,
    sumXY_a: 0,
    sumXY_q: 0,
    sumX2: 0,
  }),
  globalTrend: TrendSchema.optional(),
}).describe("Production metrics");
export type WorkflowMetrics = z.infer<typeof WorkflowMetricsSchema>;