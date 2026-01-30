// shared/types/workflow.types.ts
import { z } from "zod";
import { IdentityBase, ProjectRef, ValidDurations } from "./base.types.js";
import { SceneAttributes, SceneStatus, ScriptSupervisorScene } from "./scene.types.js";
import { CharacterAttributes } from "./character.types.js";
import { LocationAttributes } from "./location.types.js";
import { ProjectMetadata, ProjectMetadataAttributes } from "./metadata.types.js";
import { AssetRegistry } from "./assets.types.js";

// ============================================================================
// STORYBOARD ELEMENTS
// ============================================================================

export const Scene = IdentityBase
  .extend({
    ...ProjectRef.shape,
    ...SceneAttributes.shape,
    ...ScriptSupervisorScene.shape,
    ...SceneStatus.shape,
    assets: AssetRegistry,
  });
export type Scene = z.infer<typeof Scene>;

export const Character = IdentityBase.extend({
  ...ProjectRef.shape,
  ...CharacterAttributes.shape,
  assets: AssetRegistry,
});
export type Character = z.infer<typeof Character>;

export const Location = IdentityBase.extend({
  ...ProjectRef.shape,
  ...LocationAttributes.shape,
  assets: AssetRegistry,
});
export type Location = z.infer<typeof Location>;

// ============================================================================
// STORYBOARD
// ============================================================================

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

export const StoryboardAttributes = z.object({
  metadata: ProjectMetadataAttributes,
  characters: z.array(CharacterAttributes).default([]),
  locations: z.array(LocationAttributes).default([]),
  scenes: z.array(SceneAttributes).default([]),
});
export type StoryboardAttributes = z.infer<typeof StoryboardAttributes>;

export const Storyboard = z.object({
  metadata: ProjectMetadata,
  characters: z.array(Character).default([]),
  locations: z.array(Location).default([]),
  scenes: z.array(Scene).default([]),
}).readonly().describe("The immutable project snapshot");
export type Storyboard = z.infer<typeof Storyboard>;

// ============================================================================
// GENERATION 
// ============================================================================

export interface SceneGenerationInput {
  scene: SceneAttributes;
  enhancedPrompt: string;
}

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
// WORKFLOW STATE & ERRORS
// ============================================================================

export const ErrorRecord = z.object({
  projectId: z.string(),
  node: z.string(),
  error: z.string(),
  value: z.record(z.string(), z.any()).default({}),
  shouldRetry: z.boolean(),
  timestamp: z.string(),
});
export type ErrorRecord = z.infer<typeof ErrorRecord>;

export const WorkflowState = IdentityBase.pick({ id: true })
  .extend(ProjectRef.shape)
  .extend({
    localAudioPath: z.string().optional().describe("User-provided audio filepath"),
    hasAudio: z.boolean().default(false).describe("Whether this workflow uses audio"),
    jobIds: z.record(z.string(), z.string()).default({}).describe("Active generative worker jobs"),
    currentSceneIndex: z.number().default(0).describe("Index of scene currently being processed"),
    nodeAttempts: z.record(z.string(), z.number()).default({}).describe("Count of node executions in the current workflow"),
    errors: z.array(ErrorRecord).default([]).describe("Errors encountered during workflow"),
    __interrupt__: z.array(z.any()).default([]).describe("Interrupts encountered during workflow"),
    __interrupt_resolved__: z.boolean().default(false).describe("Whether interrupts have been resolved"),
  });
export type WorkflowState = z.infer<typeof WorkflowState>;

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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export interface ContinuityCheck {
  characterConsistency: boolean;
  locationConsistency: boolean;
  timingConsistency: boolean;
  issues: string[];
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

// ============================================================================
// USER
// ============================================================================

export const User = IdentityBase.extend({
  name: z.string(),
  email: z.email(),
});
export type User = z.infer<typeof User>;
