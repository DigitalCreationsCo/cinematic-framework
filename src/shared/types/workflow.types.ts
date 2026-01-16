//shared/types/pipeline.types.ts
import { z } from "zod";
import { CinematographySchema, LightingSchema, TransitionTypesSchema } from "./cinematography.types";
import { AssetRegistrySchema, WorkflowMetricsSchema } from "./metrics.types";
import { QualityEvaluationResult, QualityEvaluationResultSchema } from "./quality.types";



export const getJsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "openapi-3.0" });

// ============================================================================
// CONSTANTS
// ============================================================================

export const VALID_DURATIONS = [ 5, 6, 7, 8 ] as const;
export type ValidDuration = typeof VALID_DURATIONS[ number ];


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
  transitionType: TransitionTypesSchema.describe("cinematic transition type"),
  // --- NEW: GROUNDING FIELDS ---
  audioEvidence: z.string().describe(
    "Verifiable sonic proof from this segment (e.g., 'Heavy kick drum starts at 4.2s', 'Reverb-heavy female vocal enters', 'High-pass filter sweep')."
  ),
  transientImpact: z.enum([ "soft", "sharp", "explosive", "none" ]).describe(
    "The physical nature of the audio onset at the start of this segment."
  ),
});
export type AudioSegment = z.infer<typeof AudioSegmentSchema>;


export const AudioAnalysisSchema = z.object({
  duration: z.number().default(0).describe("Total duration in seconds"),
  bpm: z.number().describe("The detected beats per minute of the track."),
  keySignature: z.string().describe("The estimated musical key (e.g., C Minor, G Major)."),
  segments: z.array(AudioSegmentSchema).describe("List of segments covering 0.0 to totalDuration without gaps."),
});
export type AudioAnalysis = z.infer<typeof AudioAnalysisSchema> & {
  audioGcsUri: string;
  audioPublicUri?: string;
};


export const TagSchema = z.object({
  id: z.uuid({ "version": "v7" }).nonempty().nonoptional().describe("unique identifier (uuid)"),
  projectId: z.uuid({ "version": "v7" }).nonempty().nonoptional().describe("Pipeline project id"),
  createdAt: z.date().default(new Date()),
  updatedAt: z.date().default(new Date()),
});
export type Tag = z.infer<typeof TagSchema>;


// ============================================================================
// SCENE SCHEMAS
// ============================================================================

export const DirectorSceneSchema = z.object({
  description: z.string().describe("Detailed description of scene's narrative elements"),
  mood: z.string().describe("overall emotional tone combining music and narrative"),
  audioSync: z.string().optional().describe("how visuals sync with audio (Lip Sync, Mood Sync, Beat Sync)"),
}).describe("Director specifications for scene");
export type DirectorScene = z.infer<typeof DirectorSceneSchema>;


export const ScriptSupervisorSceneSchema = z.object({
  continuityNotes: z.array(z.string()).optional().describe("continuity requirements").default([]),
  characters: z.array(z.string()).describe("list of character IDs present in scene").default([]),
  locationId: z.string().describe("ID of the location where scene takes place"),
}).describe("Script Supervisor specifications for scene");
export type ScriptSupervisorScene = z.infer<typeof ScriptSupervisorSceneSchema>;


export const AssetStatusSchema = z.enum([ "pending", "generating", "evaluating", "complete", "error" ]);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;


export const SceneStatusSchema = z.object({
  status: AssetStatusSchema,
  progressMessage: z.string().optional().describe("Real-time progress message during generation"),
});
export type SceneStatus = z.infer<typeof SceneStatusSchema>;


export const SceneSchema = z.object({
  ...TagSchema.shape,
  ...AudioSegmentSchema.shape,
  ...DirectorSceneSchema.shape,
  ...CinematographySchema.shape,
  ...ScriptSupervisorSceneSchema.shape,
  ...SceneStatusSchema.shape,
  lighting: LightingSchema,
  sceneIndex: z.number().describe("Index of the scene in the storyboard"),
  assets: AssetRegistrySchema,
}).describe("Composition of all department specs + audio timing + generation outputs");
export type Scene = z.infer<typeof SceneSchema>;


export interface SceneGenerationInput {
  scene: Scene;
  enhancedPrompt: string;
}


export type GeneratedScene = Scene & {
  enhancedPrompt: string;
};


export interface SceneGenerationResult {
  scene: GeneratedScene;
  videoUrl?: string;
  attempts: number;
  finalScore: number;
  evaluation: QualityEvaluationResult | null;
  warning?: string;
  acceptedAttempt: number;
}


export interface FrameGenerationResult {
  frame: string;
  attempts: number;
  finalScore: number;
  evaluation: QualityEvaluationResult | null;
  warning?: string;
}


export interface VideoGenerationConfig {
  resolution: "480p" | "720p" | "1080p";
  durationSeconds: 4 | 6 | 8;
  numberOfVideos: number;
  personGeneration: "ALLOW_ALL" | "DONT_ALLOW";
  generateAudio: boolean;
  negativePrompt?: string;
}


// ============================================================================
// METADATA SCHEMAS
// ============================================================================

/**
 * InitialProjectMetadataSchema: Loose schema for project creation/insertion.
 * Only `projectId` and `initialPrompt` are strictly required.
 * Other fields have defaults or are optional - populated during workflow.
 */
export const InitialProjectMetadataSchema = z.object({
  projectId: z.uuid({ version: "v7" }).nonempty().nonoptional().describe("Pipeline project id"),
  title: z.string().default("").describe("title of the video"),
  totalScenes: z.number().default(0).describe("total number of scenes"),
  style: z.string().default("").describe("inferred cinematic style"),
  mood: z.string().default("").describe("overall emotional arc"),
  colorPalette: z.array(z.string()).default([]).describe("dominant colors"),
  tags: z.array(z.string()).default([]).describe("descriptive tags"),

  ...AudioAnalysisSchema.partial().omit({ segments: true }).shape,

  models: z.object({
    videoModel: z.string().optional().describe("AI model used for video generation"),
    imageModel: z.string().optional().describe("AI model used for image generation"),
    textModel: z.string().optional().describe("AI model used for text generation"),
    qaModel: z.string().optional().describe("AI model used for quality evaluation"),
  }).default({}),

  initialPrompt: z.string().describe("original creative prompt"),
  enhancedPrompt: z.string().optional().describe("enhanced user prompt with narrative, characters, settings"),
  audioGcsUri: z.string().optional().describe("GCS URI of uploaded audio file"),
  audioPublicUri: z.string().optional().describe("audio file public url"),
  hasAudio: z.boolean().default(false).describe("whether this workflow has user-provided audio"),
});
export type InitialProjectMetadata = z.infer<typeof InitialProjectMetadataSchema>;


/**
 * ProjectMetadataSchema: Strict schema for runtime application logic.
 * All fields are required (no optionals except audio-related fields).
 * Used after storyboard generation when metadata is fully populated.
 */
export const ProjectMetadataSchema = z.object({
  projectId: z.uuid({ version: "v7" }).nonempty().nonoptional().describe("Pipeline project id"),
  title: z.string().describe("title of the video"),
  totalScenes: z.number().describe("total number of scenes"),
  style: z.string().describe("inferred cinematic style"),
  mood: z.string().describe("overall emotional arc"),
  colorPalette: z.array(z.string()).describe("dominant colors"),
  tags: z.array(z.string()).describe("descriptive tags"),

  ...AudioAnalysisSchema.partial().omit({ segments: true }).shape,

  models: z.object({
    videoModel: z.string().optional().describe("AI model used for video generation"),
    imageModel: z.string().optional().describe("AI model used for image generation"),
    textModel: z.string().optional().describe("AI model used for text generation"),
    qaModel: z.string().optional().describe("AI model used for quality evaluation"),
  }),

  initialPrompt: z.string().describe("original creative prompt"),
  enhancedPrompt: z.string().describe("enhanced user prompt with narrative, characters, settings"),
  audioGcsUri: z.string().optional().describe("GCS URI of uploaded audio file"),
  audioPublicUri: z.string().optional().describe("audio file public url"),
  hasAudio: z.boolean().describe("whether this workflow has user-provided audio"),
});
export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;


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
  lastSeen: z.string().optional().describe("scene ID where character was last seen"),

  // Spatial continuity
  position: z.string().optional().describe("character's spatial position: left/center/right, foreground/background"),
  lastExitDirection: z.enum([ "left", "right", "up", "down", "none" ]).optional().describe("direction character exited frame in previous scene"),

  // Emotional progression
  emotionalState: z.string().optional().describe("character's current emotional state"),
  emotionalHistory: z.array(z.object({
    sceneId: z.string(),
    emotion: z.string(),
  })).optional().default([]).describe("emotional state timeline across scenes"),

  // Physical condition progression
  physicalCondition: z.string().optional().describe("accumulated damage, dirt, exhaustion"),
  injuries: z.array(z.object({
    type: z.string(),
    location: z.string(),
    severity: z.enum([ "minor", "moderate", "severe" ]),
    acquiredInScene: z.number(), // Using sceneIndex for temporal logic
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
  ...TagSchema.shape,

  referenceId: z.string().describe("unique identifier for the character (e.g. char_1)"),
  name: z.string().describe("character name"),
  aliases: z.array(z.string()).describe("list of aliases for the character").default([]),
  age: z.string().describe("age or age range"),

  // Costume & Makeup specifications
  physicalTraits: PhysicalTraitsSchema,
  appearanceNotes: z.array(z.string()).describe("additional notes on appearance").default([]),

  assets: AssetRegistrySchema,

  // Script Supervisor state tracking (mutable)
  state: CharacterStateSchema.optional(),
});
export type Character = z.infer<typeof CharacterSchema>;


// ============================================================================
// LOCATION SCHEMAS (Production Designer)
// ============================================================================


// Enhanced: Temporal state tracking for locations with progressive changes
export const LocationStateSchema = z.object({
  lastUsed: z.string().optional().describe("scene ID where location was last used"),

  // Temporal progression
  timeOfDay: z.string().optional().describe("current time of day (evolves across scenes)"),
  timeHistory: z.array(z.object({
    sceneId: z.string(),
    timeOfDay: z.string(),
  })).optional().default([]).describe("time progression timeline"),

  // Weather progression
  weather: z.string().optional().describe("current weather conditions"),
  weatherHistory: z.array(z.object({
    sceneId: z.string(),
    weather: z.string(),
    intensity: z.enum([ "light", "moderate", "heavy", "extreme" ]).optional(),
  })).optional().default([]).describe("weather evolution across scenes"),
  precipitation: z.enum([ "none", "light", "moderate", "heavy" ]).optional().default("none").describe("current precipitation level"),
  visibility: z.enum([ "clear", "slight_haze", "hazy", "foggy", "obscured" ]).optional().default("clear").describe("atmospheric visibility"),

  // Lighting progression
  lighting: LightingSchema,
  lightingHistory: z.array(z.object({
    sceneId: z.string(),
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
    brokenInScene: z.number(), // Using sceneIndex for temporal logic
  })).optional().default([]).describe("objects that remain broken across scenes"),

  // Atmospheric effects
  atmosphericEffects: z.array(z.object({
    type: z.string().describe("smoke, fog, dust, steam, etc."),
    intensity: z.enum([ "light", "moderate", "heavy" ]),
    addedInScene: z.number(), // Using sceneIndex for temporal logic
    dissipating: z.boolean().optional().default(false),
  })).optional().default([]).describe("lingering atmospheric effects"),

  // Temperature/season indicators (for consistency)
  season: z.enum([ "spring", "summer", "fall", "winter", "unspecified" ]).optional().describe("seasonal context for consistency"),
  temperatureIndicators: z.array(z.string()).optional().default([]).describe("visual temperature cues (e.g., 'frost on windows', 'heat shimmer')"),
});
export type LocationState = z.infer<typeof LocationStateSchema>;


export const LocationSchema = z.object({
  ...TagSchema.shape,

  referenceId: z.string().describe("narrative-scoped identifier for the location (e.g., loc_1)"),
  name: z.string().describe("location name"),
  type: z.string().optional().describe("location type (beach, urban, warehouse, etc.)"),

  // Production Designer specifications (baseline/initial state)
  lightingConditions: LightingSchema,
  timeOfDay: z.string().describe("initial time of day"),
  weather: z.string().describe("initial weather conditions").default("Clear"),
  colorPalette: z.array(z.string()).describe("dominant colors").default([]),
  mood: z.string().describe("atmospheric mood"),

  // Environmental elements (baseline)
  architecture: z.string().describe("architectural features"),
  naturalElements: z.array(z.string()).describe("natural elements in scene").default([]),
  manMadeObjects: z.array(z.string()).describe("man-made objects in scene").default([]),
  groundSurface: z.string().describe("ground surface description"),
  skyOrCeiling: z.string().describe("sky or ceiling description"),

  assets: AssetRegistrySchema,

  // Script Supervisor state tracking (mutable, evolves across scenes)
  state: LocationStateSchema.optional(),
});
export type Location = z.infer<typeof LocationSchema>;


// ============================================================================
// STORYBOARD ENRICHMENT SCHEMA
// ============================================================================

/**
 * InitialStoryboardSchema: Loose schema for project creation.
 * Uses InitialProjectMetadataSchema and allows empty arrays.
 */
export const InitialStoryboardSchema = z.object({
  metadata: InitialProjectMetadataSchema,
  characters: z.array(CharacterSchema).default([]),
  locations: z.array(LocationSchema).default([]),
  scenes: z.array(SceneSchema).default([]),
});
export type InitialStoryboard = z.infer<typeof InitialStoryboardSchema>;


/**
 * StoryboardSchema: Strict schema for immutable storyboard snapshot.
 * Uses ProjectMetadataSchema and requires populated arrays.
 */
export const StoryboardSchema = z.object({
  metadata: ProjectMetadataSchema,
  characters: z.array(CharacterSchema),
  locations: z.array(LocationSchema),
  scenes: z.array(SceneSchema),
}).readonly();
export type Storyboard = z.infer<typeof StoryboardSchema>;


export const InitialContextSchema = z.object({
  metadata: InitialProjectMetadataSchema,
  characters: z.array(CharacterSchema),
  locations: z.array(LocationSchema),
});


export const SceneBatchSchema = z.object({
  scenes: z.array(SceneSchema)
});


/**
 * InitialProjectSchema: Minimal schema for DB insertion.
 * Uses loose metadata and storyboard schemas with defaults.
 * This is the type used before storyboard generation completes.
 */
export const InitialProjectSchema = z.object({
  id: z.uuid({ "version": "v7" }).nonempty().nonoptional().describe("unique identifier (uuid)"),
  createdAt: z.date().default(new Date()),
  updatedAt: z.date().default(new Date()),

  // Loose storyboard and metadata
  storyboard: InitialStoryboardSchema.describe("The initial storyboard plan (empty at creation)"),
  metadata: InitialProjectMetadataSchema.describe("Production metadata (partial at creation)"),

  // Workflow control with defaults
  status: AssetStatusSchema.default("pending"),
  currentSceneIndex: z.number().default(0).describe("Index of scene currently being processed"),
  forceRegenerateSceneIds: z.array(z.string()).default([]).describe("List of scene IDs to force video regenerate"),

  assets: AssetRegistrySchema.default({}),
  generationRules: z.array(z.string()).default([]).describe("generation rule guidelines"),
  generationRulesHistory: z.array(
    z.array(z.string()).default([])
  ).default([]).describe("history of generation rule guidelines"),

  // Optional at creation - populated during workflow
  characters: z.array(CharacterSchema).optional(),
  locations: z.array(LocationSchema).optional(),
  scenes: z.array(SceneSchema).optional(),
  metrics: WorkflowMetricsSchema.optional(),
});
export type InitialProject = z.infer<typeof InitialProjectSchema>;


/**
 * ProjectSchema: Strict schema for runtime application logic.
 * All fields required. Used after storyboard generation completes.
 * NOT an extension of InitialProjectSchema - standalone strict definition.
 */
export const ProjectSchema = z.object({
  id: z.uuid({ "version": "v7" }).nonempty().nonoptional().describe("unique identifier (uuid)"),
  createdAt: z.date().default(new Date()),
  updatedAt: z.date().default(new Date()),

  // Strict storyboard and metadata
  storyboard: StoryboardSchema.describe("The immutable storyboard snapshot"),
  metadata: ProjectMetadataSchema.describe("Fully populated production metadata"),

  // Workflow control
  status: AssetStatusSchema,
  currentSceneIndex: z.number().describe("Index of scene currently being processed"),
  forceRegenerateSceneIds: z.array(z.string()).describe("List of scene IDs to force video regenerate"),

  assets: AssetRegistrySchema,
  generationRules: z.array(z.string()).describe("generation rule guidelines"),
  generationRulesHistory: z.array(
    z.array(z.string())
  ).describe("history of generation rule guidelines"),

  // Required at runtime - hydrated from DB
  characters: z.array(CharacterSchema),
  locations: z.array(LocationSchema),
  scenes: z.array(SceneSchema),
  metrics: WorkflowMetricsSchema,
});
export type Project = z.infer<typeof ProjectSchema>;


export type ErrorRecord = {
  node: string;
  error: string;
  skipped: boolean;
  timestamp: string;
};


// ============================================================================
// USER SCHEMA
// ============================================================================

export const UserSchema = z.object({
  id: z.uuid({ "version": "v7" }),
  name: z.string(),
  email: z.email().optional(),
  createdAt: z.string().default(new Date().toISOString()),
  updatedAt: z.string().default(new Date().toISOString()),
});


// ============================================================================
// WORKFLOW STATE
// ============================================================================

export const WorkflowStateSchema = z.object({
  ...TagSchema.shape,

  initialProject: z.union([ InitialProjectSchema, z.null() ]),
  project: z.union([ ProjectSchema, z.null() ]),

  localAudioPath: z.string().optional().describe("user-provided audio filepath"),
  hasAudio: z.boolean().default(false).describe("whether this workflow uses audio"),

  // Transient execution data
  jobIds: z.record(z.string(), z.string()).describe("Active generative worker jobs"),
  currentSceneIndex: z.number().describe("index of scene currently being processed").default(0),
  nodeAttempts: z.record(z.string(), z.number()).describe("Count of node executions inthe current workflow"),

  errors: z.array(z.object({
    projectId: z.string(),
    node: z.string(),
    message: z.string(),
    value: z.record(z.string(), z.any()),
    shouldRetry: z.boolean(),
    timestamp: z.string(),
  })).describe("errors encountered during workflow").default([]),
});
export type WorkflowState = Omit<z.infer<typeof WorkflowStateSchema>, "createdAt" | "updatedAt"> & {
  __interrupt__?: { value: LlmRetryInterruptValue; }[];
  __interrupt_resolved__?: boolean;
};


// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface ContinuityCheck {
  characterConsistency: boolean;
  locationConsistency: boolean;
  timingConsistency: boolean;
  issues: string[];
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
    (scene.lyrics && scene.lyrics.length > 0) ||
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


export interface LlmRetryInterruptValue {
  type: "llm_retry_exhausted" | "llm_intervention" | "waiting_for_job" | "waiting_for_batch";
  error: string;
  errorDetails?: Record<string, any>;
  stackTrace?: string;
  functionName: string;
  nodeName: string;
  projectId: string;
  params?: Record<string, any>;
  attempt?: number;
  maxRetries?: number;
  lastAttemptTimestamp: string;
}


export * from "./cinematography.types";
export * from "./metrics.types";
export * from "./quality.types";
