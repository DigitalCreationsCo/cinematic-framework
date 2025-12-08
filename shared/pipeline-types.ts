import { z } from "zod";

export const QualityScoreSchema = z.object({
  rating: z.enum(["PASS", "MINOR_ISSUES", "MAJOR_ISSUES", "FAIL"]),
  weight: z.number().max(1),
  details: z.string(),
});
export type QualityScore = z.infer<typeof QualityScoreSchema>;

export const QualityIssueSchema = z.object({
  category: z.string(),
  severity: z.enum(["critical", "major", "minor"]),
  description: z.string(),
  videoTimestamp: z.string().optional(),
  suggestedFix: z.string(),
});
export type QualityIssue = z.infer<typeof QualityIssueSchema>;

export const PromptCorrectionSchema = z.object({
  issueType: z.string(),
  originalPromptSection: z.string(),
  correctedPromptSection: z.string(),
  reasoning: z.string(),
});
export type PromptCorrection = z.infer<typeof PromptCorrectionSchema>;

export const QualityEvaluationSchema = z.object({
  scores: z.object({
    narrativeFidelity: QualityScoreSchema,
    characterConsistency: QualityScoreSchema,
    technicalQuality: QualityScoreSchema,
    emotionalAuthenticity: QualityScoreSchema,
    continuity: QualityScoreSchema,
  }),
  issues: z.array(QualityIssueSchema),
  feedback: z.string(),
  promptCorrections: z.array(PromptCorrectionSchema).optional(),
  ruleSuggestion: z.string().optional(),
});

const QualityEvaluationResultSchema = z.intersection(
  QualityEvaluationSchema,
  z.object({
    overall: z.enum(["ACCEPT", "ACCEPT_WITH_NOTES", "REGENERATE_MINOR", "REGENERATE_MAJOR", "FAIL"]),
  })
);
export type QualityEvaluationResult = z.infer<typeof QualityEvaluationResultSchema>;

export const CharacterStateSchema = z.object({
  lastSeen: z.number().optional(),
  currentAppearance: z.object({
    hair: z.string(),
    clothing: z.string(),
    accessories: z.array(z.string()),
  }).optional(),
  position: z.string().optional(),
  emotionalState: z.string().optional(),
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  description: z.string(),
  referenceImageUrls: z.array(z.string()).optional(),
  physicalTraits: z.object({
    hair: z.string(),
    clothing: z.string(),
    accessories: z.array(z.string()),
    distinctiveFeatures: z.array(z.string()),
  }),
  appearanceNotes: z.array(z.string()),
  state: CharacterStateSchema.optional(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const LocationStateSchema = z.object({
  lastUsed: z.number().optional(),
  lighting: z.string().optional(),
  weather: z.string().optional(),
  timeOfDay: z.string().optional(),
});
export type LocationState = z.infer<typeof LocationStateSchema>;

export const LocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  lightingConditions: z.string(),
  timeOfDay: z.string(),
  referenceImageUrls: z.array(z.string()).optional(),
  state: LocationStateSchema.optional(),
});
export type Location = z.infer<typeof LocationSchema>;

export const AudioSegmentSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  duration: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  type: z.enum(["lyrical", "instrumental", "transition", "breakdown", "solo", "climax"]),
  lyrics: z.string(),
  description: z.string(),
  musicChange: z.string(),
  intensity: z.enum(["low", "medium", "high", "extreme"]),
  mood: z.string(),
  tempo: z.enum(["slow", "moderate", "fast", "very_fast"]),
  transitionType: z.string(),
});
export type AudioSegment = z.infer<typeof AudioSegmentSchema>;

export const SceneSchema = z.intersection(
  AudioSegmentSchema,
  z.object({
    id: z.number(),
    shotType: z.string(),
    description: z.string(),
    cameraMovement: z.string(),
    lighting: z.string(),
    mood: z.string(),
    audioSync: z.string(),
    continuityNotes: z.array(z.string()),
    characters: z.array(z.string()).default([]),
    locationId: z.string(),
    enhancedPrompt: z.string().optional(),
    generatedVideoUrl: z.string().optional(),
    evaluation: QualityEvaluationResultSchema.optional(),
    startFrameUrl: z.string().optional(),
    endFrameUrl: z.string().optional(),
  })
);
export type Scene = z.infer<typeof SceneSchema>;

export const VideoMetadataSchema = z.object({
  title: z.string(),
  duration: z.number(),
  totalScenes: z.number(),
  style: z.string(),
  mood: z.string(),
  colorPalette: z.array(z.string()),
  tags: z.array(z.string()),
  videoModel: z.string().optional(),
  imageModel: z.string().optional(),
  audioModel: z.string().optional(),
});
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;

export const StoryboardSchema = z.object({
  metadata: VideoMetadataSchema,
  characters: z.array(CharacterSchema),
  locations: z.array(LocationSchema),
  scenes: z.array(SceneSchema),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

export const SceneGenerationMetricSchema = z.object({
  sceneId: z.number(),
  attempts: z.number(),
  bestAttempt: z.number(),
  finalScore: z.number(),
  duration: z.number(),
  ruleAdded: z.boolean(),
});
export type SceneGenerationMetric = z.infer<typeof SceneGenerationMetricSchema>;

export const WorkflowMetricsSchema = z.object({
  sceneMetrics: z.array(SceneGenerationMetricSchema),
  globalTrend: z.object({
    averageAttempts: z.number(),
    attemptTrendSlope: z.number(),
    qualityTrendSlope: z.number(),
  }).optional(),
});
export type WorkflowMetrics = z.infer<typeof WorkflowMetricsSchema>;

export type PipelineStatus = "idle" | "analyzing" | "generating" | "evaluating" | "complete" | "error";
export type SceneStatus = "pending" | "generating" | "evaluating" | "complete" | "failed";

export interface PipelineMessage {
  id: string;
  type: "info" | "warning" | "error" | "success";
  message: string;
  timestamp: Date;
  sceneId?: number;
}
