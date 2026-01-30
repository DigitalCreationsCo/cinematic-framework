// shared/types/scene.types.ts
import { z } from "zod";
import { AssetStatus } from "./assets.types.js";
import { Cinematography, Lighting } from "./cinematography.types.js";
import { AudioSegmentAttributes } from "./audio.types.js";

// ============================================================================
// SCENE COMPOSITION
// ============================================================================

export const DirectorScene = z.object({
  description: z.string().default("").describe("Detailed description of scene's narrative elements"),
  mood: z.string().default("").describe("overall emotional tone combining music and narrative"),
  audioSync: z.string().default("Mood Sync").describe("how visuals sync with audio (Lip Sync, Mood Sync, Beat Sync)"),
}).describe("Director specifications for scene");
export type DirectorScene = z.infer<typeof DirectorScene>;


export const ScriptSupervisorScene = z.object({
  continuityNotes: z.array(z.string()).describe("continuity requirements").default([]),
  characterReferenceIds: z.array(z.string()).describe("Flattened list of character reference IDs present in scene (not uuid). Example: 'char_hero, char_villain'"),
  characterIds: z.array(z.uuid()).describe("Flattened list of character IDs present in scene"),
  locationReferenceId: z.string().describe("Reference ID where scene takes place (not uuid). Example: 'loc_beach, loc_warehouse'"),
  locationId: z.uuid().describe("Location ID where scene takes place."),
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
  ...ScriptSupervisorScene.omit({ characterIds: true, locationId: true }).shape,
}).describe("Composition of all department specs + audio timing + generation outputs");
export type SceneAttributes = z.infer<typeof SceneAttributes>;