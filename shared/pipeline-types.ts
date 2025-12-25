import { z } from "zod";

// @ts-ignore
export const zodToJSONSchema = (schema: z.ZodType) => z.toJSONSchema(schema);

// ============================================================================
// AUDIO ANALYSIS SCHEMAS (Director: Musical Structure)
// ============================================================================

export const AudioSegmentSchema = z.object({
  startTime: z.number().describe("start time in seconds"),
  endTime: z.number().describe("end time in seconds"),
  duration: z.union([ z.literal(4), z.literal(6), z.literal(8) ]).describe("Duration in seconds (4, 6, or 8)"),
  type: z.enum([ "lyrical", "instrumental", "transition", "breakdown", "solo", "climax" ]),
  lyrics: z.string().describe("Transcribed lyrics if lyrical, empty otherwise"),
  musicalDescription: z.string().describe("Detailed description of the sound, instruments, tempo, mood"),
  musicChange: z.string().describe("Notable changes: key signature, tempo shift, instrumentation changes, dynamic shifts"),
  intensity: z.enum([ "low", "medium", "high", "extreme" ]).describe("Energy level of this segment"),
  mood: z.string().describe("Emotional tone (e.g., aggressive, melancholic, triumphant, mysterious)"),
  tempo: z.enum([ "slow", "moderate", "fast", "very_fast" ]).describe("Pace of the music"),
  transitionType: z.string().describe("cinematic transition type (e.g., Cut, Dissolve, Fade, Smash Cut, Wipe)"),
});
export type AudioSegment = z.infer<typeof AudioSegmentSchema>;

export const AudioAnalysisSchema = z.object({
  totalDuration: z.number().describe("Total duration of the track in seconds"),
  segments: z.array(AudioSegmentSchema).describe("list of analyzed musical segments"),
});
export type AudioAnalysis = z.infer<typeof AudioAnalysisSchema> & {
  audioGcsUri: string;
  audioPublicUri?: string;
};

// ============================================================================
// STORAGE OBJECT SCHEMAS
// ============================================================================

export const ObjectDataSchema = z.object({
  storageUri: z.string(),
  publicUri: z.string()
});
export type ObjectData = z.infer<typeof ObjectDataSchema>;

// ============================================================================
// CINEMATOGRAPHY SCHEMAS (Cinematographer)
// ============================================================================

export const CinematographySchema = z.object({
  shotType: z.string().describe("ECU, CU, MCU, MS, MW, WS, VW"),
  cameraAngle: z.string().optional().describe("Eye Level, High Angle, Low Angle, Bird's Eye, Dutch"),
  cameraMovement: z.string().describe("Static, Pan, Tilt, Dolly, Track, Handheld, Crane"),
  composition: z.string().optional().describe("subject placement, focal point, depth layers"),
});
export type Cinematography = z.infer<typeof CinematographySchema>;

// ============================================================================
// LIGHTING SCHEMAS (Gaffer)
// ============================================================================

export const LightingSchema = z.object({
  quality: z.string().describe("lighting quality specification"),
  colorTemperature: z.string().optional().describe("Warm/Neutral/Cool with Kelvin"),
  intensity: z.string().optional().describe("Low/Medium/High"),
  motivatedSources: z.string().optional().describe("where light comes from"),
  direction: z.string().optional().describe("key light position, shadow direction"),
});
export type Lighting = z.infer<typeof LightingSchema>;

// ============================================================================
// CHARACTER SCHEMAS (Costume & Makeup Dept)
// ============================================================================

export const PhysicalTraitsSchema = z.object({
  hair: z.string().describe("specific hairstyle, color, length, texture"),
  clothing: z.union([
    z.string(),
    z.array(z.string())
  ]).describe("specific outfit description (string or array of garments)"),
  accessories: z.array(z.string()).describe("list of accessories").default([]),
  distinctiveFeatures: z.array(z.string()).describe("list of distinctive features").default([]),
  build: z.string().optional().describe("physical build description"),
  ethnicity: z.string().optional().describe("ethnicity description (generic, non-specific)"),
});
export type PhysicalTraits = z.infer<typeof PhysicalTraitsSchema>;

// Enhanced: Temporal state tracking for Script Supervisor with progressive changes
export const CharacterStateSchema = z.object({
  lastSeen: z.number().optional().describe("scene ID where character was last seen"),

  // Spatial continuity
  position: z.string().optional().describe("character's spatial position: left/center/right, foreground/background"),
  lastExitDirection: z.enum([ "left", "right", "up", "down", "none" ]).optional().describe("direction character exited frame in previous scene"),

  // Emotional progression
  emotionalState: z.string().optional().describe("character's current emotional state"),
  emotionalHistory: z.array(z.object({
    sceneId: z.number(),
    emotion: z.string(),
  })).optional().default([]).describe("emotional state timeline across scenes"),

  // Physical condition progression
  physicalCondition: z.string().optional().describe("accumulated damage, dirt, exhaustion"),
  injuries: z.array(z.object({
    type: z.string(),
    location: z.string(),
    severity: z.enum([ "minor", "moderate", "severe" ]),
    acquiredInScene: z.number(),
  })).optional().default([]).describe("injuries that persist across scenes"),

  // Appearance changes
  dirtLevel: z.enum([ "clean", "slightly_dirty", "dirty", "very_dirty", "covered" ]).optional().default("clean").describe("accumulation of dirt, mud, dust"),
  exhaustionLevel: z.enum([ "fresh", "slightly_tired", "tired", "exhausted", "collapsing" ]).optional().default("fresh").describe("progressive fatigue"),
  sweatLevel: z.enum([ "dry", "slight", "moderate", "heavy", "drenched" ]).optional().default("dry").describe("perspiration level"),

  // Costume state progression
  costumeCondition: z.object({
    tears: z.array(z.string()).optional().default([]).describe("torn areas (e.g., 'sleeve torn', 'pants ripped at knee')"),
    stains: z.array(z.string()).optional().default([]).describe("stains (e.g., 'blood on shirt', 'mud on pants')"),
    wetness: z.enum([ "dry", "damp", "wet", "soaked" ]).optional().default("dry").describe("moisture level of clothing"),
    damage: z.array(z.string()).optional().default([]).describe("other damage (e.g., 'burned collar', 'missing button')"),
  }).optional().describe("progressive costume degradation"),

  // Makeup/hair changes
  hairCondition: z.object({
    style: z.string().optional().describe("current style (should match baseline unless narrative justification)"),
    messiness: z.enum([ "pristine", "slightly_messy", "messy", "disheveled", "wild" ]).optional().default("pristine"),
    wetness: z.enum([ "dry", "damp", "wet", "soaked" ]).optional().default("dry"),
  }).optional().describe("progressive hair state changes"),
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;

export const CharacterSchema = z.object({
  id: z.string().describe("unique identifier for the character (e.g. char_1)"),
  name: z.string().describe("character name"),
  aliases: z.array(z.string()).describe("list of aliases for the character").default([]),
  description: z.string().describe("detailed physical and personality description"),
  age: z.union([ z.number(), z.string() ]).optional().describe("age or age range"),

  // Costume & Makeup specifications
  physicalTraits: PhysicalTraitsSchema,
  appearanceNotes: z.array(z.string()).describe("additional notes on appearance").default([]),
  referenceImages: z.array(ObjectDataSchema).describe("URLs to reference images for continuity").default([]),

  // Script Supervisor state tracking (mutable)
  state: CharacterStateSchema.optional(),
});
export type Character = z.infer<typeof CharacterSchema>;

// ============================================================================
// LOCATION SCHEMAS (Production Designer)
// ============================================================================

// Enhanced: Temporal state tracking for locations with progressive changes
export const LocationStateSchema = z.object({
  lastUsed: z.number().optional().describe("scene ID where location was last used"),

  // Temporal progression
  timeOfDay: z.string().optional().describe("current time of day (evolves across scenes)"),
  timeHistory: z.array(z.object({
    sceneId: z.number(),
    timeOfDay: z.string(),
  })).optional().default([]).describe("time progression timeline"),

  // Weather progression
  weather: z.string().optional().describe("current weather conditions"),
  weatherHistory: z.array(z.object({
    sceneId: z.number(),
    weather: z.string(),
    intensity: z.enum([ "light", "moderate", "heavy", "extreme" ]).optional(),
  })).optional().default([]).describe("weather evolution across scenes"),
  precipitation: z.enum([ "none", "light", "moderate", "heavy" ]).optional().default("none").describe("current precipitation level"),
  visibility: z.enum([ "clear", "slight_haze", "hazy", "foggy", "obscured" ]).optional().default("clear").describe("atmospheric visibility"),

  // Lighting progression
  lighting: LightingSchema,
  lightingHistory: z.array(z.object({
    sceneId: z.number(),
    lighting: LightingSchema,
  })).optional().default([]).describe("lighting changes timeline"),

  // Environmental state changes
  groundCondition: z.object({
    wetness: z.enum([ "dry", "damp", "wet", "soaked", "flooded" ]).optional().default("dry"),
    debris: z.array(z.string()).optional().default([]).describe("accumulated debris (e.g., 'broken glass', 'fallen leaves')"),
    damage: z.array(z.string()).optional().default([]).describe("environmental damage (e.g., 'crater', 'burn marks')"),
  }).optional().describe("progressive ground surface changes"),

  // Object/prop persistence
  brokenObjects: z.array(z.object({
    object: z.string(),
    description: z.string(),
    brokenInScene: z.number(),
  })).optional().default([]).describe("objects that remain broken across scenes"),

  // Atmospheric effects
  atmosphericEffects: z.array(z.object({
    type: z.string().describe("smoke, fog, dust, steam, etc."),
    intensity: z.enum([ "light", "moderate", "heavy" ]),
    addedInScene: z.number(),
    dissipating: z.boolean().optional().default(false),
  })).optional().default([]).describe("lingering atmospheric effects"),

  // Temperature/season indicators (for consistency)
  season: z.enum([ "spring", "summer", "fall", "winter", "unspecified" ]).optional().describe("seasonal context for consistency"),
  temperatureIndicators: z.array(z.string()).optional().default([]).describe("visual temperature cues (e.g., 'frost on windows', 'heat shimmer')"),
});
export type LocationState = z.infer<typeof LocationStateSchema>;

export const LocationSchema = z.object({
  id: z.string().describe("unique identifier for the location (e.g., loc_1)"),
  name: z.string().describe("location name"),
  description: z.string().describe("detailed location description"),
  type: z.string().optional().describe("location type (beach, urban, warehouse, etc.)"),

  // Production Designer specifications (baseline/initial state)
  lightingConditions: LightingSchema,
  timeOfDay: z.string().describe("initial time of day"),
  weather: z.string().optional().describe("initial weather conditions").default("Clear"),
  colorPalette: z.array(z.string()).optional().describe("dominant colors").default([]),
  mood: z.string().optional().describe("atmospheric mood"),

  // Environmental elements (baseline)
  architecture: z.string().optional().describe("architectural features"),
  naturalElements: z.array(z.string()).optional().describe("natural elements in scene").default([]),
  manMadeObjects: z.array(z.string()).optional().describe("man-made objects in scene").default([]),
  groundSurface: z.string().optional().describe("ground surface description"),
  skyOrCeiling: z.string().optional().describe("sky or ceiling description"),

  // Production state
  referenceImages: z.array(ObjectDataSchema).optional().describe("URLs to reference images for continuity").default([]),

  // Script Supervisor state tracking (mutable, evolves across scenes)
  state: LocationStateSchema.optional(),
});
export type Location = z.infer<typeof LocationSchema>;

// ============================================================================
// METADATA SCHEMAS
// ============================================================================

export const VideoMetadataSchema = z.object({
  title: z.string().describe("title of the video"),
  duration: z.number().describe("total duration in seconds"),
  totalScenes: z.number().describe("total number of scenes"),
  style: z.string().optional().describe("inferred cinematic style"),
  mood: z.string().optional().describe("overall emotional arc"),
  colorPalette: z.array(z.string()).optional().describe("dominant colors").default([]),
  tags: z.array(z.string()).optional().describe("descriptive tags").default([]),

  // Production metadata
  videoModel: z.string().optional().describe("AI model used for video generation"),
  imageModel: z.string().optional().describe("AI model used for image generation"),
  textModel: z.string().optional().describe("AI model used for text generation"),
  creativePrompt: z.string().optional().describe("original creative prompt"),
});
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;

// ============================================================================
// QUALITY EVALUATION SCHEMAS (Quality Control Supervisor)
// ============================================================================

// Shared department enum (eliminates repetition)
export const DepartmentEnum = z.enum([
  "director",
  "cinematographer",
  "gaffer",
  "script_supervisor",
  "costume",
  "production_design"
]);
export type Department = z.infer<typeof DepartmentEnum>;

// Shared severity enum
export const SeverityEnum = z.enum([ "critical", "major", "minor" ]);
export type Severity = z.infer<typeof SeverityEnum>;

// Shared rating enum
export const RatingEnum = z.enum([ "PASS", "MINOR_ISSUES", "MAJOR_ISSUES", "FAIL" ]);
export type Rating = z.infer<typeof RatingEnum>;

export const QualityScoreSchema = z.object({
  rating: RatingEnum,
  weight: z.number().min(0).max(1),
  details: z.string().describe("Detailed explanation"),
});
export type QualityScore = z.infer<typeof QualityScoreSchema>;

export const QualityIssueSchema = z.object({
  department: DepartmentEnum.describe("Which department's specs were not met"),
  category: z.string().describe("Issue category (narrative, composition, lighting, continuity, appearance)"),
  severity: SeverityEnum,
  description: z.string().describe("Specific problem observed"),
  videoTimestamp: z.string().optional().describe("Timestamp in video (e.g., 0:02-0:04)"),
  locationInFrame: z.string().optional().describe("Location in frame for image issues"),
  suggestedFix: z.string().describe("How the department should revise specs"),
});
export type QualityIssue = z.infer<typeof QualityIssueSchema>;

export const PromptCorrectionSchema = z.object({
  department: DepartmentEnum,
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
  feedback: z.string().describe("Overall summary of quality assessment"),
  promptCorrections: z.array(PromptCorrectionSchema).optional(),
  ruleSuggestion: z.string().optional().describe("A new global rule to prevent future systemic issues"),
});

const QualityEvaluationResultSchema = z.intersection(
  QualityEvaluationSchema,
  z.object({
    overall: z.enum([ "ACCEPT", "ACCEPT_WITH_NOTES", "REGENERATE_MINOR", "REGENERATE_MAJOR", "FAIL" ]),
  })
);
export type QualityEvaluationResult = z.infer<typeof QualityEvaluationResultSchema>;
export { QualityEvaluationResultSchema };

// ============================================================================
// SCENE SCHEMAS (Composed from All Departments)
// ============================================================================

// Director specifications for scene
export const DirectorSceneSchema = z.object({
  description: z.string().describe("Detailed description of scene's narrative elements"),
  mood: z.string().describe("overall emotional tone combining music and narrative"),
  audioSync: z.string().optional().describe("how visuals sync with audio (Lip Sync, Mood Sync, Beat Sync)"),
});
export type DirectorScene = z.infer<typeof DirectorSceneSchema>;

// Script Supervisor specifications for scene
export const ScriptSupervisorSceneSchema = z.object({
  continuityNotes: z.array(z.string()).optional().describe("continuity requirements").default([]),
  characters: z.array(z.string()).describe("list of character IDs present in scene").default([]),
  locationId: z.string().describe("ID of the location where scene takes place"),
});
export type ScriptSupervisorScene = z.infer<typeof ScriptSupervisorSceneSchema>;

export const SceneStatusSchema = z.enum([ "pending", "generating", "evaluating", "complete", "error" ]);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

// Scene generation outputs
export const SceneGenerationOutputSchema = z.object({
  enhancedPrompt: z.string().optional().describe("composed prompt from all departments"),
  startFramePrompt: z.string().optional().describe("The exact prompt used to generate the start frame"),
  endFramePrompt: z.string().optional().describe("The exact prompt used to generate the end frame"),
  generatedVideo: ObjectDataSchema.describe("GCS URL of generated video"),
  startFrame: ObjectDataSchema.optional().describe("GCS URL of start keyframe"),
  endFrame: ObjectDataSchema.optional().describe("GCS URL of end keyframe"),
  bestAttempt: z.number().describe("The attempt number that was selected as the best result"),
  evaluation: QualityEvaluationResultSchema.optional().describe("Quality evaluation result"),
  status: SceneStatusSchema,
  progressMessage: z.string().optional().describe("Real-time progress message during generation"),
});
export type SceneGenerationOutput = z.infer<typeof SceneGenerationOutputSchema>;

// Complete Scene: Composition of all department specs + audio timing + generation outputs
// Flattened to a single object to simplify JSON Schema generation for LLMs
export const SceneSchema = z.object({
  ...AudioSegmentSchema.shape,
  ...DirectorSceneSchema.shape,
  ...CinematographySchema.shape,
  ...ScriptSupervisorSceneSchema.shape,
  ...SceneGenerationOutputSchema.shape,
  lighting: LightingSchema,
  id: z.number().describe("unique numeric identifier for the scene"),
});
export type Scene = z.infer<typeof SceneSchema>;

// ============================================================================
// STORYBOARD SCHEMA (Production Plan)
// ============================================================================

export const StoryboardSchema = z.object({
  metadata: VideoMetadataSchema,
  characters: z.array(CharacterSchema),
  locations: z.array(LocationSchema),
  scenes: z.array(SceneSchema),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

// ============================================================================
// STORYBOARD ENRICHMENT SCHEMA
// ============================================================================

export const InitialContextSchema = z.object({
  metadata: StoryboardSchema.shape.metadata,
  characters: StoryboardSchema.shape.characters,
  locations: StoryboardSchema.shape.locations,
});

export const SceneBatchSchema = z.object({
  scenes: z.array(SceneSchema)
});

// ============================================================================
// METRICS SCHEMA (Production Tracking)
// ============================================================================

export const SceneGenerationMetricSchema = z.object({
  sceneId: z.number(),
  attempts: z.number(),
  bestAttempt: z.number(),
  finalScore: z.number(),
  duration: z.number(),
  ruleAdded: z.boolean(),
});
export type SceneGenerationMetric = z.infer<typeof SceneGenerationMetricSchema>;

export const AttemptMetricSchema = z.object({
  sceneId: z.number(),
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
  sceneMetrics: z.array(SceneGenerationMetricSchema),
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
});
export type WorkflowMetrics = z.infer<typeof WorkflowMetricsSchema>;

// ============================================================================
// GRAPH STATE (LangGraph Workflow)
// ============================================================================

export const InitialGraphStateSchema = z.object({
  // Initial input
  localAudioPath: z.string().optional().describe("user-provided audio filepath"),
  creativePrompt: z.string().optional().describe("user's creative prompt with narrative, characters, settings"),
  audioGcsUri: z.string().optional().describe("GCS URI of uploaded audio file"),
  audioPublicUri: z.string().optional().describe("Public URI of uploaded audio file"),
  hasAudio: z.boolean().default(false).describe("whether this workflow uses audio"),

  // Production plan (immutable reference)
  storyboard: StoryboardSchema.optional().describe("The initial, immutable storyboard plan"),

  // Production state (mutable, updated scene by scene)
  storyboardState: StoryboardSchema.optional().describe("Current production state"),

  // Execution tracking
  currentSceneIndex: z.number().describe("index of scene currently being processed").default(0),
  forceRegenerateSceneId: z.number().optional().describe("ID of scene to force regenerate"),
  scenePromptOverrides: z.record(z.number(), z.string()).optional().describe("Manual overrides for scene prompts"),
  renderedVideo: ObjectDataSchema.optional().describe("GCS URL of final stitched video"),
  errors: z.array(z.object({
    node: z.string(),
    error: z.string(),
    skipped: z.boolean(),
    timestamp: z.string(),
  })).describe("errors encountered during workflow").default([]),

  // Quality feedback loop
  generationRules: z.array(z.string()).optional().describe("raw generation rule suggestions").default([]),
  refinedRules: z.array(z.string()).optional().describe("consolidated, actionable generation rules").default([]),

  // Production metrics
  metrics: WorkflowMetricsSchema.optional(),

  // generation attempt state tracking
  attempts: z.record(z.string(), z.number()).describe("Map of resource IDs to their latest attempt count").default({}),
});
export type InitialGraphState = z.infer<typeof InitialGraphStateSchema> & {
  __interrupt__?: { value: LlmRetryInterruptValue; }[];
  __interrupt_resolved__?: boolean;
};

export const GraphStateSchema = z.intersection(
  InitialGraphStateSchema,
  z.object({
    creativePrompt: z.string().describe("user's creative prompt"),
    storyboard: StoryboardSchema.describe("immutable storyboard plan"),
    storyboardState: StoryboardSchema.describe("current production state"),
    generationRules: z.array(z.string()).describe("raw generation rules"),
    refinedRules: z.array(z.string()).describe("consolidated rules"),
  })
);
export type GraphState = z.infer<typeof GraphStateSchema> & {
  __interrupt__?: { value: LlmRetryInterruptValue; }[];
  __interrupt_resolved__?: boolean;
};

// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface SceneGenerationInput {
  scene: Scene;
  enhancedPrompt: string;
  startFrame?: string;
  endFrame?: string;
  characterReferencereferenceImages?: string[];
  locationReferencereferenceImages?: string[];
}

export interface ContinuityCheck {
  characterConsistency: boolean;
  locationConsistency: boolean;
  timingConsistency: boolean;
  issues: string[];
}

export interface VideoGenerationConfig {
  resolution: "480p" | "720p" | "1080p";
  durationSeconds: 4 | 6 | 8;
  numberOfVideos: number;
  personGeneration: "ALLOW_ALL" | "DONT_ALLOW";
  generateAudio: boolean;
  negativePrompt?: string;
}

export type GeneratedScene = Scene & {
  enhancedPrompt: string;
  generatedVideo: ObjectData;
};

export interface SceneGenerationResult {
  scene: GeneratedScene;
  attempts: number;
  finalScore: number;
  evaluation: QualityEvaluationResult | null;
  warning?: string;
  usedAttempt: number;
}

export interface FrameGenerationResult {
  frame: ObjectData;
  attempts: number;
  finalScore: number;
  evaluation: QualityEvaluationResult | null;
  warning?: string;
}

// ============================================================================
// CONSTANTS (Cinematographer & Director Reference)
// ============================================================================

export const VALID_DURATIONS = [ 5, 6, 7, 8 ] as const;
export type ValidDuration = typeof VALID_DURATIONS[ number ];

export const TRANSITION_TYPES = [
  "Cut",
  "Hard Cut",
  "Jump Cut",
  "Smash Cut",
  "Dissolve",
  "Cross Fade",
  "Fade",
  "Fade to Black",
  "Wipe",
  "Iris In",
  "Iris Out",
  "Push",
  "Slide",
] as const;
export type TransitionType = typeof TRANSITION_TYPES[ number ];

// Cinematographer shot type menu (aligned with role-cinematographer.ts)
export const SHOT_TYPES = [
  "ECU", // Extreme Close-Up
  "CU", // Close-Up
  "MCU", // Medium Close-Up
  "MS", // Medium Shot
  "MW", // Medium Wide
  "WS", // Wide Shot
  "VW", // Very Wide/Establishing
] as const;
export type ShotType = typeof SHOT_TYPES[ number ];

// Cinematographer camera movement menu (aligned with role-cinematographer.ts)
export const CAMERA_MOVEMENTS = [
  "Static",
  "Pan Left",
  "Pan Right",
  "Pan", // Generic pan
  "Tilt Up",
  "Tilt Down",
  "Tilt", // Generic tilt
  "Dolly In",
  "Dolly Out",
  "Track Left",
  "Track Right",
  "Track", // Generic track
  "Crane Up",
  "Crane Down",
  "Crane", // Generic crane
  "Handheld",
  "Steadicam",
  "Drone",
  "Aerial",
  "Orbit",
  "Zoom In",
  "Zoom Out",
] as const;
export type CameraMovement = typeof CAMERA_MOVEMENTS[ number ];

// Cinematographer camera angle menu (aligned with role-cinematographer.ts)
export const CAMERA_ANGLES = [
  "Eye Level",
  "High Angle",
  "Low Angle",
  "Bird's Eye",
  "Dutch Angle",
] as const;
export type CameraAngle = typeof CAMERA_ANGLES[ number ];

export interface QualityConfig {
  enabled: boolean;
  acceptThreshold: number;
  minorIssueThreshold: number;
  majorIssueThreshold: number;
  failThreshold: number;
  maxRetries: number;
  safetyRetries: number;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isValidDuration(duration: number): duration is 4 | 6 | 8 {
  return duration === 4 || duration === 6 || duration === 8;
}

export function isLyricalScene(scene: Scene): boolean {
  return (
    scene.audioSync === "Lip Sync" ||
    (scene.lyrics !== undefined && scene.lyrics.length > 0) ||
    false
  );
}

export function isInstrumentalScene(scene: Scene): boolean {
  return (
    scene.audioSync === "Mood Sync" ||
    scene.description?.includes("[Instrumental") ||
    false
  );
}

export function requiresTransition(scene: Scene): boolean {
  return scene.transitionType !== "Cut" && scene.transitionType !== "none";
}

export type PipelineStatus = "ready" | "analyzing" | "generating" | "evaluating" | "complete" | "error" | "paused";

export interface PipelineMessage {
  id: string;
  type: "info" | "warning" | "error" | "success";
  message: string;
  timestamp: Date;
  sceneId?: number;
}

export interface LlmRetryInterruptValue {
  type: "llm_retry_exhausted" | "llm_intervention";
  error: string;
  errorDetails?: Record<string, any>;
  functionName: string;
  nodeName: string;
  params: Record<string, any>;
  attemptCount?: number;
  lastAttemptTimestamp?: string;
  stackTrace?: string;
}

export type StatusType = PipelineStatus | SceneStatus | "PASS" | "MINOR_ISSUES" | "MAJOR_ISSUES" | "FAIL" | "ACCEPT" | "ACCEPT_WITH_NOTES" | "REGENERATE_MINOR" | "REGENERATE_MAJOR";
