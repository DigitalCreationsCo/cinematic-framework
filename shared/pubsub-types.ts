import { GraphState } from "./pipeline-types";

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
    | RegenerateSceneCommand
    | RegenerateFrameCommand
    | ResolveInterventionCommand;

export type StartPipelineCommand = PubSubMessage<
    "START_PIPELINE",
    {
        audioGcsUri?: string;
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

export type RegenerateFrameCommand = PubSubMessage<
    "REGENERATE_FRAME",
    {
        sceneId: number;
        frameType: "start" | "end";
        promptModification: string;
    }
>;

export type ResolveInterventionCommand = PubSubMessage<
    "RESOLVE_INTERVENTION",
    {
        action: "retry" | "skip" | "abort";
        revisedParams?: Record<string, any>;
    }
>;


// ===== EVENTS (Pipeline -> Server -> Client) =====

export type PipelineEvent =
    | WorkflowStartedEvent
    | FullStateEvent
    | SceneStartedEvent
    | SceneProgressEvent
    | SceneCompletedEvent
    | SceneSkippedEvent
    | WorkflowCompletedEvent
    | WorkflowFailedEvent
    | LlmInterventionNeededEvent
    | InterventionResolvedEvent
    | LogEvent;


export type SceneProgressEvent = PubSubMessage<
    "SCENE_PROGRESS",
    {
        sceneId: number;
        progressMessage: string;
        progress?: number; // 0-100
        startFrame?: any; // ObjectData
        endFrame?: any; // ObjectData
    }
>;

export type LogEvent = PubSubMessage<
    "LOG",
    {
        level: "info" | "warning" | "error" | "success";
        message: string;
        sceneId?: number;
    }
>;

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
        nodeName?: string;
    }
>;

export type LlmInterventionNeededEvent = PubSubMessage<
    "LLM_INTERVENTION_NEEDED",
    {
        error: string;
        params: Record<string, any>;
        functionName: string;
        nodeName: string;
        attemptCount?: number;
    }
>;

export type InterventionResolvedEvent = PubSubMessage<
    "INTERVENTION_RESOLVED",
    {
        action: "retry" | "skip" | "abort";
        nodeName: string;
    }
>;