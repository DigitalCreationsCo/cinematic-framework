// shared/types/audio.types.ts
import { z } from "zod";
import { VALID_DURATIONS, ValidDurations } from "./base.types.js";
import { TransitionTypes } from "./cinematography.types.js";

// ============================================================================
// AUDIO ANALYSIS
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
export type AudioIdentity = z.infer<typeof AudioIdentity>;

export const AudioAnalysis = AudioIdentity.extend(AudioAnalysisAttributes.shape);
export type AudioAnalysis = z.infer<typeof AudioAnalysis>;
