import { GraphState, InitialGraphState, ObjectData, SceneStatus } from "./pipeline-types";

export type PubSubMessage<T extends string, P = undefined> = P extends undefined ? {
    type: T;
    projectId: string;
    commandId?: string;
    timestamp: string;
} : {
    type: T;
    projectId: string;
    commandId?: string;
    timestamp: string;
    payload: P;
};

// ===== COMMANDS (Client -> Server -> Pipeline) =====

export type PipelineCommand =
    | StartPipelineCommand
    | RequestFullStateCommand
    | ResumePipelineCommand
    | StopPipelineCommand
    | RegenerateSceneCommand
    | RegenerateFrameCommand
    | ResolveInterventionCommand
    | UpdateSceneAssetCommand;

export type StartPipelineCommand = PubSubMessage<
    "START_PIPELINE",
    {
        audioGcsUri?: string;
        audioPublicUri?: string;
        creativePrompt: string;
    }
>;

export type RequestFullStateCommand = PubSubMessage<
    "REQUEST_FULL_STATE",
    (Record<string, never> | undefined)
>;

export type ResumePipelineCommand = PubSubMessage<
    "RESUME_PIPELINE",
    {
        fromSceneIndex?: number;
    } | undefined
>;

export type StopPipelineCommand = PubSubMessage<
    "STOP_PIPELINE"
>;

export type RegenerateSceneCommand = PubSubMessage<
    "REGENERATE_SCENE",
    {
        sceneId: number;
        forceRegenerate?: boolean;
        promptModification?: string;
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

export type UpdateSceneAssetCommand = PubSubMessage<
    "UPDATE_SCENE_ASSET",
    {
        sceneId: number;
        assetType: "startFrame" | "endFrame" | "video";
        attempt: number | null; // null means delete/reject
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
        status?: SceneStatus;
        progress?: number;
        startFrame?: ObjectData;
        endFrame?: ObjectData;
        generatedVideo?: ObjectData;
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
        initialState: InitialGraphState;
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