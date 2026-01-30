// shared/types/pipeline.types.ts
import { Project } from "./entities.types.js";
import { Scene } from "./workflow.types.js";
import { AssetStatus, AssetKey, AssetType, Scope, AssetVersion } from "./assets.types.js";
import { VersionMetric } from "./metrics.types.js";

// ============================================================================
// PUBSUB MESSAGE BASE
// ============================================================================

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

// ============================================================================
// COMMANDS (Client -> Server -> Pipeline)
// ============================================================================

export type PipelineCommand =
    | StartPipelineCommand
    | RequestFullStateCommand
    | ResumePipelineCommand
    | StopPipelineCommand
    | RegenerateSceneCommand
    | RegenerateFrameCommand
    | ResolveInterventionCommand
    | UpdateSceneAssetCommand;

export type StartPipelineCommand = {
    type: "START_PIPELINE";
    projectId?: string;
    commandId?: string;
    timestamp: string;
    payload: {
        audioGcsUri?: string;
        audioPublicUri?: string;
        initialPrompt: string;
        title?: string;
    };
};

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
        sceneId: string;
        forceRegenerate: boolean;
        promptModification: string;
    }
>;

export type RegenerateFrameCommand = PubSubMessage<
    "REGENERATE_FRAME",
    {
        sceneId: string;
        frameType: "start" | "end";
        promptModification: string;
    }
>;

export type UpdateSceneAssetCommand = PubSubMessage<
    "UPDATE_SCENE_ASSET",
    {
        scene: Scene;
        assetKey: AssetKey;
        version: number | null; // null means delete/reject
    }
>;

export type ResolveInterventionCommand = PubSubMessage<
    "RESOLVE_INTERVENTION",
    {
        action: "retry" | "skip" | "abort";
        revisedParams?: Record<string, any>;
    }
>;

// ============================================================================
// EVENTS (Pipeline -> Server -> Client)
// ============================================================================

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

export type LogEvent = PubSubMessage<
    "LOG",
    {
        level: "info" | "warn" | "error" | "success"; 
        message: string;
        sceneId?: string;
        [ key: string ]: any;
    }
>;

export type WorkflowStartedEvent = PubSubMessage<"WORKFLOW_STARTED", { project: Project; }>;

export type FullStateEvent = PubSubMessage<"FULL_STATE", { project: Project; }>;

export type SceneStartedEvent = PubSubMessage<"SCENE_STARTED", { scene: Scene; totalScenes: number; }>;

export type SceneProgressEvent = PubSubMessage<"SCENE_UPDATE", { scene: Scene; progress?: number; }>;

export type SceneCompletedEvent = PubSubMessage<"SCENE_COMPLETED", { scene: Scene; }>;

export type SceneSkippedEvent = PubSubMessage<"SCENE_SKIPPED", { sceneId: string; reason: string; videoUrl?: string; }>;

export type WorkflowCompletedEvent = PubSubMessage<"WORKFLOW_COMPLETED">;

export type WorkflowFailedEvent = PubSubMessage<"WORKFLOW_FAILED", { error: string; nodeName?: string; }>;

export type LlmInterventionNeededEvent = PubSubMessage<
    "LLM_INTERVENTION_NEEDED",
    {
        error: string;
        params?: Record<string, any>;
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

// ============================================================================
// PIPELINE STATE & CALLBACKS
// ============================================================================

export interface PipelineMessage {
    id: string;
    type: "info" | "warn" | "error" | "success";
    message: string;
    timestamp: Date;
    sceneId?: string;
}
export type PipelineStatus = "ready" | "analyzing" | "generating" | "evaluating" | "complete" | "error" | "paused";
export type StatusType = PipelineStatus | AssetStatus | "PASS" | "MINOR_ISSUES" | "MAJOR_ISSUES" | "FAIL" | "ACCEPT" | "ACCEPT_WITH_NOTES" | "REGENERATE_MINOR" | "REGENERATE_MAJOR";

export type SaveAssetsCallbackArgs = [
    scope: Scope,
    assetKey: AssetKey,
    type: AssetType,
    dataList: string[],
    metadata: Omit<AssetVersion[ 'metadata' ], 'jobId'>,
    setBest?: boolean,
];
export type SaveAssetsCallback = (...args: SaveAssetsCallbackArgs) => void;
export type UpdateSceneCallbackArgs = [
    scene: Scene,
    saveToDb?: boolean,
];
export type UpdateSceneCallback = (...args: UpdateSceneCallbackArgs) => void;
export type GetAttemptMetricCallback = (attemptMetric: Pick<VersionMetric, "assetKey" | "finalScore" | "startTime" | "ruleAdded" | "attemptNumber" | "assetVersion" | "corrections">) => void;
export type OnAttemptCallback = (attempt: number) => void;