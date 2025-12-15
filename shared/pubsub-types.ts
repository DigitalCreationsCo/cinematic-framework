import { GraphState } from "./pipeline-types";

// Generic wrapper for all Pub/Sub messages
export interface PubSubMessage<T extends string, P> {
    type: T;
    projectId: string;
    payload: P;
    timestamp: string;
}

// ===== COMMANDS (Client -> Server -> Pipeline) =====

export type PipelineCommand =
    | StartPipelineCommand
    | RequestFullStateCommand
    | ResumePipelineCommand
    | StopPipelineCommand
    | RegenerateSceneCommand;

export type StartPipelineCommand = PubSubMessage<
    "START_PIPELINE",
    {
        audioUrl?: string; // Optional if only using creative prompt
        creativePrompt: string;
    }
>;

export type RequestFullStateCommand = PubSubMessage<
    "REQUEST_FULL_STATE",
    Record<string, never> // No payload needed
>;

export type ResumePipelineCommand = PubSubMessage<
    "RESUME_PIPELINE",
    {
        fromSceneIndex?: number;
    }
>;

export type StopPipelineCommand = PubSubMessage<
    "STOP_PIPELINE",
    Record<string, never> // No payload needed
>;

export type RegenerateSceneCommand = PubSubMessage<
    "REGENERATE_SCENE",
    {
        sceneId: number;
        forceRegenerate?: boolean;
        promptModification?: string; // Optional modified prompt for this generation
    }
>;


// ===== EVENTS (Pipeline -> Server -> Client) =====

export type PipelineEvent =
    | WorkflowStartedEvent
    | FullStateEvent
    | SceneStartedEvent
    | SceneCompletedEvent
    | SceneSkippedEvent
    | WorkflowCompletedEvent
    | WorkflowFailedEvent
    | PipelineStatusEvent;


export type WorkflowStartedEvent = PubSubMessage<
    "WORKFLOW_STARTED",
    {
        initialState: GraphState;
    }
>;

export type FullStateEvent = PubSubMessage<
    "FULL_STATE",
    {
        state: GraphState;
    }
>;

export type SceneStartedEvent = PubSubMessage<
    "SCENE_STARTED",
    {
        sceneId: number;
        sceneIndex: number;
        totalScenes: number;
    }
>;

export type SceneCompletedEvent = PubSubMessage<
    "SCENE_COMPLETED",
    {
        sceneId: number;
        sceneIndex: number;
        videoUrl?: string;
        // Include any relevant data about the completed scene
    }
>;

export type SceneSkippedEvent = PubSubMessage<
    "SCENE_SKIPPED",
    {
        sceneId: number;
        reason: string;
        videoUrl?: string;
    }
>;

export type WorkflowCompletedEvent = PubSubMessage<
    "WORKFLOW_COMPLETED",
    {
        finalState: GraphState;
        videoUrl: string;
    }
>;

export type WorkflowFailedEvent = PubSubMessage<
    "WORKFLOW_FAILED",
    {
        error: string;
    }
>;

export type PipelineStatusEvent = PubSubMessage<
    "PIPELINE_STATUS",
    {
        status: "idle" | "running" | "paused" | "error";
        currentStep?: string;
        message?: string;
    }
>;
