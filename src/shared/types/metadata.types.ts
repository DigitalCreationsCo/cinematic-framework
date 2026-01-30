// shared/types/metadata.types.ts
import { z } from "zod";
import { ProjectRef } from "./base.types.js";
import { AudioAnalysis } from "./audio.types.js";



// ============================================================================
// PROJECT METADATA
// ============================================================================

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
