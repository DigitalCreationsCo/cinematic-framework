import { PipelineCommand } from "../../shared/pubsub-types";
import { WorkflowService } from "../services/workflow-service";

export async function handleUpdateSceneAssetCommand(
    command: Extract<PipelineCommand, { type: "UPDATE_SCENE_ASSET"; }>,
    workflowService: WorkflowService,
) {
    const { projectId, payload } = command;
    try {
        await workflowService.updateSceneAsset(projectId, payload.sceneId, payload.assetType, payload.attempt);
    } catch (error) {
        console.error("Error handling UPDATE_SCENE_ASSET:", error);
    }
}
