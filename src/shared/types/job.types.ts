//shared/types/job.types.ts

import { AssetKey } from "./assets.types.js";
import { AudioAnalysis } from "./audio.types.js";
import { Character, Location } from "./workflow.types.js";
import { QualityEvaluationResult } from "./quality.types.js";
import { Scene, SceneGenerationResult, StoryboardAttributes } from "./index.js";



// ============================================================================
// JOB PROPERTIES
// ============================================================================

export const JOB_STATES = [
    "CREATED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "FATAL",
    "CANCELLED"
] as const;
export type JobState = (typeof JOB_STATES)[ number ];

export const JOB_TYPES = [
    "EXPAND_CREATIVE_PROMPT",
    "GENERATE_STORYBOARD",
    "PROCESS_AUDIO_TO_SCENES",
    "ENHANCE_STORYBOARD",
    "SEMANTIC_ANALYSIS",
    "GENERATE_CHARACTER_ASSETS",
    "GENERATE_LOCATION_ASSETS",
    "GENERATE_SCENE_FRAMES",
    "GENERATE_SCENE_VIDEO",
    "RENDER_VIDEO",
    "FRAME_RENDER"
] as const;
export type JobType = (typeof JOB_TYPES)[ number ];

// ============================================================================
// JOB RECORDS
// ============================================================================

export type JobRecord =
    | JobRecordExpandCreativePrompt
    | JobRecordGenerateStoryboard
    | JobRecordProcessAudioToScenes
    | JobRecordEnhanceStoryboard
    | JobRecordSemanticAnalysis
    | JobRecordGenerateCharacterAssets
    | JobRecordGenerateLocationAssets
    | JobRecordGenerateSceneFrames
    | JobRecordGenerateSceneVideo
    | JobRecordStitchVideo
    | JobRecordFrameRender;

type JobRecordBase<T extends JobType, R = undefined, P = undefined> = R extends undefined ? {
    id: string;
    projectId: string;
    type: T;
    state: JobState;
    error?: string;
    uniqueKey?: string;
    assetKey: AssetKey;
    attempt: number;
    maxRetries: number;
    createdAt: Date;
    updatedAt: Date;
    payload: P;
} : {
    id: string;
    projectId: string;
    type: T;
    state: JobState;
    result: R;
    error?: string;
    uniqueKey?: string;
    assetKey: AssetKey;
    attempt: number;
    maxRetries: number;
    createdAt: Date;
    updatedAt: Date;
    payload: P;
};

export type JobRecordExpandCreativePrompt = JobRecordBase<
    "EXPAND_CREATIVE_PROMPT"
>;

export type JobRecordGenerateStoryboard = JobRecordBase<
    "GENERATE_STORYBOARD"
>;

export type JobRecordProcessAudioToScenes = JobRecordBase<
    "PROCESS_AUDIO_TO_SCENES"
>;

export type JobRecordEnhanceStoryboard = JobRecordBase<
    "ENHANCE_STORYBOARD"
>;

export type JobRecordSemanticAnalysis = JobRecordBase<
    "SEMANTIC_ANALYSIS"
>;

export type JobRecordGenerateCharacterAssets = JobRecordBase<
    "GENERATE_CHARACTER_ASSETS"
>;

export type JobRecordGenerateLocationAssets = JobRecordBase<
    "GENERATE_LOCATION_ASSETS"
>;

export type JobRecordGenerateSceneFrames = JobRecordBase<
    "GENERATE_SCENE_FRAMES"
>;

export type JobRecordGenerateSceneVideo = JobRecordBase<
    "GENERATE_SCENE_VIDEO",
    undefined,
    {
        sceneId: string;
        sceneIndex: number;
        version: number;
        overridePrompt: boolean;
    }
>;

export type JobRecordStitchVideo = JobRecordBase<
    "RENDER_VIDEO",
    undefined,
    {
        videoPaths: string[];
        audioGcsUri?: string;
    }
>;

export type JobRecordFrameRender = JobRecordBase<
    "FRAME_RENDER",
    undefined,
    {
        scene: Scene;
        prompt: string;
        framePosition: "start" | "end";
        sceneCharacters: Character[];
        sceneLocations: Location[];
        previousFrame?: string;
        referenceImages: string[];
    }
>;

// ============================================================================
// GENERATIVE AI RESULT TYPES
// ============================================================================

export type GenerativeResultEnvelope<T> = {
    data: T;
    metadata: {
        model: string;
        evaluation?: QualityEvaluationResult;
        attempts: number;
        acceptedAttempt: number;
        warning?: string;
    };
};

export type GenerativeResultExpandCreativePrompt = GenerativeResultEnvelope<{
    expandedPrompt: string;
}>;

export type GenerativeResultGenerateStoryboard = GenerativeResultEnvelope<{
    storyboardAttributes: StoryboardAttributes;
}>;

export type GenerativeResultProcessAudioToScenes = GenerativeResultEnvelope<{
    analysis: AudioAnalysis;
}>;

export type GenerativeResultEnhanceStoryboard = GenerativeResultEnvelope<{
    storyboardAttributes: StoryboardAttributes;
}>;

export type GenerativeResultSemanticAnalysis = GenerativeResultEnvelope<{
    dynamicRules: string[];
}>;

export type GenerativeResultGenerateCharacterAssets = GenerativeResultEnvelope<{
    characters: Character[];
}>;

export type GenerativeResultGenerateLocationAssets = GenerativeResultEnvelope<{
    locations: Location[];
}>;

export type GenerativeResultGenerateSceneFrames = GenerativeResultEnvelope<{
    updatedScenes: Scene[];
}>;

export type GenerativeResultGenerateSceneVideo = GenerativeResultEnvelope<SceneGenerationResult>;

export type GenerativeResultStitchVideo = GenerativeResultEnvelope<{
    renderedVideo: string;
}>;

export type GenerativeResultFrameRender = GenerativeResultEnvelope<{
    scene: Scene;
    image: string;
}>;

// ============================================================================
// JOB EVENTS
// ============================================================================

export type JobEvent =
    | { type: "JOB_DISPATCHED"; jobId: string; projectId: string; }
    | { type: "JOB_STARTED"; jobId: string; }
    | { type: "JOB_COMPLETED"; jobId: string; projectId: string; }
    | { type: "JOB_FAILED"; jobId: string; error: string; }
    | { type: "JOB_CANCELLED"; jobId: string; };