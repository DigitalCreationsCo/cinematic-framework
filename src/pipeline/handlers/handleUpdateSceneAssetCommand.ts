import { PipelineCommand } from "../../shared/types/pubsub.types";
import { WorkflowOperator } from "../services/workflow-service";
import { PipelineCommandHandler } from "../services/command-handler";

export async function handleUpdateSceneAssetCommand(
    command: Extract<PipelineCommand, { type: "UPDATE_SCENE_ASSET"; }>,
    workflowOperator: WorkflowOperator,
) {
    const { projectId } = command;
    try {
        // Atomic DB Update
        await PipelineCommandHandler.handleUpdateAsset(command);
        
        // Broadcast new state to client
        await workflowOperator.getProjectState(projectId);
        
    } catch (error) {
        console.error("Error handling UPDATE_SCENE_ASSET:", error);
    }
}
