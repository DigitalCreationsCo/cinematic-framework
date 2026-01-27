//shared/types/pipeline.types.ts
import { z } from "zod";
import { Cinematography, Lighting, TransitionTypes } from "./cinematography.types.js";
import { AssetRegistry, WorkflowMetrics } from "./metrics.types.js";
import { IdentityBase, ProjectRef } from "./identity.types.js";
import { v7 as uuidv7 } from "uuid";
import { roundToValidDuration } from "../utils/utils.js";
import { InsertCharacter, InsertLocation, InsertScene } from "../db/zod-db.js";



// ============================================================================
// BASE IDENTITY & UTILITIES
// ============================================================================

export const VALID_DURATIONS = [ 5, 6, 7, 8 ] as const;
export const ValidDurations = z.preprocess((val) => roundToValidDuration(Number(val)), z.union(VALID_DURATIONS.map(duration => z.literal(duration)) as z.ZodLiteral<number>[])).describe("Valid segment duration in seconds");
export type ValidDurations = typeof VALID_DURATIONS[ number ];


// ============================================================================
// AUDIO ANALYSIS (Musical Structure)
// ============================================================================

export const AudioSegmentAttributes = z.object({
  startTime: z.number().describe("start time in seconds"),
  endTime: z.number().describe("end time in seconds"),
  duration: ValidDurations.default(VALID_DURATIONS[ 0 ]).describe("Segment duration in seconds"),
  type: z.enum([ "lyrical", "instrumental", "transition", "breakdown", "solo", "climax" ]),
  lyrics: z.string().describe("Transcribed lyrics if lyrical, empty otherwise"),
  musicalDescription: z.string().describe("Detailed description of the sound, instruments, tempo, mood"),
  musicChange: z.string().describe("Notable changes: key signature, tempo shift, instrumentation changes, dynamic shifts"),
  intensity: z.enum([ "low", "medium", "high", "extreme" ]).describe("Energy level of this segment"),
  mood: z.string().describe("Emotional tone (e.g., aggressive, melancholic, triumphant, mysterious)"),
  tempo: z.enum([ "slow", "moderate", "fast", "very_fast" ]).describe("Pace of the music"),
  transitionType: TransitionTypes.describe("cinematic transition type"),
  audioEvidence: z.string().describe("Verifiable sonic proof from this segment (e.g., 'Heavy kick drum starts at 4.2s', 'Reverb-heavy female vocal enters', 'High-pass filter sweep')."),
  transientImpact: z.enum([ "soft", "sharp", "explosive", "none" ]).describe("The physical nature of the audio onset at the start of this segment."),
});
export type AudioSegmentAttributes = z.infer<typeof AudioSegmentAttributes>;


export const AudioAnalysisAttributes = z.object({
  duration: z.number().default(0).describe("Combined duration of all segments in seconds"),
  bpm: z.number().default(120).describe("The detected beats per minute of the track."),
  keySignature: z.string().default("C Major").describe("The estimated musical key (e.g., C Minor, G Major)."),
  segments: z.array(AudioSegmentAttributes).describe("List of segments covering 0.0 to totalDuration without gaps."),
});
export type AudioAnalysisAttributes = z.infer<typeof AudioAnalysisAttributes>;

export const AudioIdentity = z.object({
  audioGcsUri: z.string().optional().describe("GCS URI of uploaded audio file"),
  audioPublicUri: z.string().optional().describe("audio file public url"),
});

export const AudioAnalysis = AudioIdentity.extend(AudioAnalysisAttributes.shape);
export type AudioAnalysis = z.infer<typeof AudioAnalysis>;


// ============================================================================
// SCENE COMPOSITION
// ============================================================================

export const AssetStatus = z.enum([ "pending", "generating", "evaluating", "complete", "error" ]).default("pending");
export type AssetStatus = z.infer<typeof AssetStatus>;

export const DirectorScene = z.object({
  description: z.string().default("").describe("Detailed description of scene's narrative elements"),
  mood: z.string().default("").describe("overall emotional tone combining music and narrative"),
  audioSync: z.string().default("Mood Sync").describe("how visuals sync with audio (Lip Sync, Mood Sync, Beat Sync)"),
}).describe("Director specifications for scene");
export type DirectorScene = z.infer<typeof DirectorScene>;


export const ScriptSupervisorScene = z.object({
  continuityNotes: z.array(z.string()).optional().describe("continuity requirements").default([]),
  characters: z.preprocess(
    (val) => {
      if (Array.isArray(val) && val.length > 0 && typeof val[ 0 ] === 'object') {
        return val.map((item) => item.character?.id || item.characterId);
      }
      return val;
    },
    z.array(z.string())
  ).describe("Flattened list of character IDs present in scene").default([]),
  location: z.string().default("").describe("ID of the location where scene takes place"),
}).describe("Script Supervisor specifications for scene");
export type ScriptSupervisorScene = z.infer<typeof ScriptSupervisorScene>;


export const SceneStatus = z.object({
  status: AssetStatus,
  progressMessage: z.string().default("").describe("Real-time progress message during generation"),
});
export type SceneStatus = z.infer<typeof SceneStatus>;


export const SceneAttributes = z.object({
  sceneIndex: z.number().describe("Index of the scene in the storyboard"),
  lighting: Lighting.default(() => (Lighting.parse({}))),
  ...Cinematography.shape,
  ...AudioSegmentAttributes.shape,
  ...DirectorScene.shape,
  ...ScriptSupervisorScene.shape,
}).describe("Composition of all department specs + audio timing + generation outputs");
export type SceneAttributes = z.infer<typeof SceneAttributes>; 


export interface SceneGenerationInput {
  scene: SceneAttributes;
  enhancedPrompt: string;
}

export const SceneWithoutCharacters = IdentityBase
  .extend({
    ...ProjectRef.shape,
    ...SceneAttributes.shape,
    ...SceneStatus.shape,
    assets: AssetRegistry,
  }).omit({ characters: true });
export type SceneWithoutCharacters = z.infer<typeof SceneWithoutCharacters>;

export const Scene = IdentityBase
  .extend({
    ...ProjectRef.shape,
    ...SceneAttributes.shape,
    ...SceneStatus.shape,
    assets: AssetRegistry,
  });
export type Scene = z.infer<typeof Scene>;

export type SceneGenerationResult = {
  scene: Scene;
  enhancedPrompt: string;
  videoUrl: string;
};

export interface VideoGenerationConfig {
  resolution: "480p" | "720p" | "1080p";
  durationSeconds: ValidDurations;
  numberOfVideos: number;
  personGeneration: "ALLOW_ALL" | "DONT_ALLOW";
  generateAudio: boolean;
  negativePrompt?: string;
}


// ============================================================================
// CHARACTER AND LOCATION SCHEMAS
// ============================================================================

export const PhysicalTraits = z.object({
  hair: z.string().default("").describe("Specific hairstyle, color, length, texture"),
  clothing: z.array(z.string()).default([]).describe("Specific outfit description (string or array of garments)"),
  accessories: z.array(z.string()).default([]).describe("List of accessories"),
  distinctiveFeatures: z.array(z.string()).default([]).describe("List of distinctive features"),
  build: z.string().default("average").describe("Physical build description"),
  ethnicity: z.string().default("").describe("Ethnicity description (generic, non-specific)"),
}).describe("Costume & Makeup specifications");
export type PhysicalTraits = z.infer<typeof PhysicalTraits>;


export const CharacterState = z.object({
  // Spatial continuity
  lastSeen: z.string().optional().describe("scene ID where character was last seen"),
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
export type CharacterState = z.infer<typeof CharacterState>;


export const CharacterAttributes = z.object({
  referenceId: z.string().describe("Narrative-scoped identifier for the character e.g. char_1"),
  name: z.string().describe("Character name"),
  aliases: z.array(z.string()).default([]).describe("Character aliases"),
  age: z.string().describe("Character age"),
  physicalTraits: PhysicalTraits,
  appearanceNotes: z.array(z.string()).default([]).describe("Additional appearance notes"),
  state: CharacterState.describe("Character state"),
});
export type CharacterAttributes = z.infer<typeof CharacterAttributes>;

export const Character = IdentityBase
  .extend({
    ...ProjectRef.shape,
    ...CharacterAttributes.shape,
    assets: AssetRegistry,
  });
export type Character = z.infer<typeof Character>;


export const WeatherIntensity = z.enum([ "light", "moderate", "heavy", "extreme" ]).default("light");
export type WeatherIntensity = z.infer<typeof WeatherIntensity>;


export const LocationState = z.object({
  lastUsed: z.string().describe("scene ID where location was last used"),
  mood: z.string().describe("Atmospheric mood").default("Serene"),
  timeOfDay: z.string().describe("current time of day (evolves across scenes)"),
  timeHistory: z.array(z.object({
    sceneId: z.string(),
    timeOfDay: z.string(),
  })).default([]).describe("time progression timeline"),
  weather: z.string().describe("current weather conditions"),
  weatherHistory: z.array(z.object({
    sceneId: z.string(),
    weather: z.string(),
    intensity: WeatherIntensity,
  })).default([]).describe("weather evolution across scenes"),
  precipitation: z.enum([ "none", "light", "moderate", "heavy" ]).default("none").describe("current precipitation level"),
  visibility: z.enum([ "clear", "slight_haze", "hazy", "foggy", "obscured" ]).default("clear").describe("atmospheric visibility"),

  lighting: Lighting,
  lightingHistory: z.array(z.object({
    sceneId: z.string(),
    lighting: Lighting,
  })).default([]).describe("lighting changes timeline"),

  groundCondition: z.object({
    wetness: z.enum([ "dry", "damp", "wet", "soaked", "flooded" ]).default("dry"),
    debris: z.array(z.string()).default([]).describe("accumulated debris (e.g., 'broken glass', 'fallen leaves')"),
    damage: z.array(z.string()).default([]).describe("environmental damage (e.g., 'crater', 'burn marks')"),
  }).default({
    wetness: "dry",
    debris: [],
    damage: [],
  }).describe("progressive ground surface changes"),

  brokenObjects: z.array(z.object({
    object: z.string(),
    description: z.string(),
    brokenInScene: z.number(), // Using sceneIndex for temporal logic
  })).default([]).describe("objects that remain broken across scenes"),

  atmosphericEffects: z.array(z.object({
    type: z.string().describe("smoke, fog, dust, steam, etc."),
    intensity: z.enum([ "light", "moderate", "heavy" ]),
    addedInScene: z.number(),
    dissipating: z.boolean().default(false),
  })).default([]).describe("lingering atmospheric effects"),

  season: z.enum([ "spring", "summer", "fall", "winter", "unspecified" ]).default("unspecified").describe("seasonal context for consistency"),
  temperatureIndicators: z.array(z.string()).default([]).describe("visual temperature cues (e.g., 'frost on windows', 'heat shimmer')"),
});
export type LocationState = z.infer<typeof LocationState>;


export const LocationAttributes = z.object({
  referenceId: z.string().describe("Narrative-scoped identifier for the location (e.g., loc_1)"),
  name: z.string().describe("Location name"),
  type: z.string().describe("Location type e.g. beach, urban, warehouse, etc."),
  lightingConditions: Lighting,
  mood: z.string().describe("Atmospheric mood").default("Serene"),
  timeOfDay: z.string().describe("Time of day").default("Dawn"),
  weather: z.string().describe("Weather conditions").default("Clear"),
  colorPalette: z.array(z.string()).describe("Dominant colors").default([]),
  architecture: z.array(z.string()).describe("Architectural features").default([]),
  naturalElements: z.array(z.string()).describe("Natural elements in scene").default([]),
  manMadeObjects: z.array(z.string()).describe("Man-made objects in scene").default([]),
  groundSurface: z.string().describe("Ground surface description").default(""),
  skyOrCeiling: z.string().describe("Sky or ceiling description").default(""),
  state: LocationState.describe("Location state"),
});
export type LocationAttributes = z.infer<typeof LocationAttributes>;

export const Location = IdentityBase
  .extend({
    ...ProjectRef.shape,
    ...LocationAttributes.shape,
    assets: AssetRegistry,
  });
export type Location = z.infer<typeof Location>;


// ============================================================================
// METADATA SCHEMAS
// ============================================================================

/**
 * ProjectMetadataSchema: Strict schema for runtime application logic.
 * `initialPrompt` does not have default value.
 * All fields are required (no optionals except audio-related fields).
 * Used after storyboard generation when metadata is fully populated.
 * Empty fields are parsed and populated during workflow.
*/
export const ProjectMetadataAttributes = z.object({
  title: z.string().default("").describe("Title of the video"),
  logline: z.string().default("").describe("One sentence capturing the core story"),
  totalScenes: z.number().default(0).describe("Total number of scenes"),
  style: z.string().default("").describe("Inferred cinematic style"),
  mood: z.string().default("").describe("Overall emotional arc"),
  colorPalette: z.array(z.string()).default([]).describe("Dominant colors"),
  tags: z.array(z.string()).default([]).describe("Descriptive tags"),
  initialPrompt: z.string().describe("Original creative prompt"),
  enhancedPrompt: z.string().default("").describe("Enhanced user prompt with narrative, characters, settings"),
  audioGcsUri: z.string().optional().describe("GCS URI of uploaded audio file"),
  audioPublicUri: z.string().optional().describe("Audio file public URL"),
  hasAudio: z.boolean().default(false).describe("Whether this workflow has user-provided audio"),
})
  .extend(AudioAnalysis.omit({ segments: true }).shape);
export type ProjectMetadataAttributes = z.infer<typeof ProjectMetadataAttributes>;

export const ProjectMetadata = ProjectMetadataAttributes
  .extend(ProjectRef.shape);
export type ProjectMetadata = z.infer<typeof ProjectMetadata>;


// ============================================================================
// STORYBOARD ENRICHMENT SCHEMA
// ============================================================================

export const StoryboardAttributes = z.object({
  metadata: ProjectMetadataAttributes,
  characters: z.array(CharacterAttributes).default([]),
  locations: z.array(LocationAttributes).default([]),
  scenes: z.array(SceneAttributes).default([]),
});
export type StoryboardAttributes = z.infer<typeof StoryboardAttributes>;


/**
 * Storyboard: Strict schema for immutable storyboard snapshot.
 */
export const Storyboard = z.object({
  metadata: ProjectMetadata,
  characters: z.array(Character).default([]),
  locations: z.array(Location).default([]),
  scenes: z.array(Scene).default([]),
});
export type Storyboard = z.infer<typeof Storyboard>;


export const InitialStoryboardContext = z.object({
  metadata: ProjectMetadataAttributes,
  characters: z.array(CharacterAttributes).default([]),
  locations: z.array(LocationAttributes).default([]),
});
export type InitialStoryboardContext = z.infer<typeof InitialStoryboardContext>;


export const SceneBatch = z.object({
  scenes: z.array(SceneAttributes)
});
export type SceneBatch = z.infer<typeof SceneBatch>;


export const GenerationRules = z.array(z.string()).default([]).describe("generation rule guidelines");


/**
 * ProjectSchema: Strict schema for runtime application logic.
 */
export const Project = IdentityBase.extend({
  storyboard: Storyboard.readonly().describe("The immutable storyboard snapshot"),
  metadata: ProjectMetadata.describe("Fully populated production metadata"),
  metrics: WorkflowMetrics,
  assets: AssetRegistry,
  audioAnalysis: AudioAnalysisAttributes.nullish(),
  status: AssetStatus.default("pending"),
  currentSceneIndex: z.number().default(0).describe("Index of scene currently being processed"),
  forceRegenerateSceneIds: z.array(z.string()).default([]).describe("List of scene IDs to force video regenerate"),
  generationRules: GenerationRules,
  generationRulesHistory: z.preprocess((val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") { try { return JSON.parse(val); } catch { return []; } }
    return [];
  }, z.array(GenerationRules)).default([]).describe("history of generation rule guidelines"),
  scenes: z.array(Scene).default([]),
  characters: z.array(Character).default([]),
  locations: z.array(Location).default([]),
});
export type Project = z.infer<typeof Project>;


// ============================================================================
// USER SCHEMA
// ============================================================================

export const User = IdentityBase.extend({
  name: z.string(),
  email: z.email(),
});
export type User = z.infer<typeof User>;


// ============================================================================
// WORKFLOW STATE
// ============================================================================

export const ErrorRecord = z.object({
  projectId: z.string(),
  node: z.string(),
  error: z.string(),
  value: z.record(z.string(), z.any()).default({}),
  shouldRetry: z.boolean(),
  timestamp: z.string(),
});


export const WorkflowState = IdentityBase.pick({ id: true })
  .extend(ProjectRef.shape)
  .extend({
    localAudioPath: z.string().optional().describe("User-provided audio filepath"),
    hasAudio: z.boolean().default(false).describe("Whether this workflow uses audio"),
    jobIds: z.record(z.string(), z.string()).default({}).describe("Active generative worker jobs"),
    currentSceneIndex: z.number().default(0).describe("Index of scene currently being processed").default(0),
    nodeAttempts: z.record(z.string(), z.number()).default({}).describe("Count of node executions inthe current workflow"),
    errors: z.array(ErrorRecord).default([]).describe("Errors encountered during workflow"),
    __interrupt__: z.array(z.any()).default([]).describe("Interrupts encountered during workflow"),
    __interrupt_resolved__: z.boolean().default(false).describe("Whether interrupts have been resolved"),
  });
export type WorkflowState = z.infer<typeof WorkflowState>;


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

export function isValidDuration(duration: number): duration is ValidDurations {
  return VALID_DURATIONS.includes(duration as ValidDurations);
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


export * from "./cinematography.types.js";
export * from "./metrics.types.js";
export * from "./quality.types.js";
