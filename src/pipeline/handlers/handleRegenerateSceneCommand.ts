import { PipelineCommand } from "../../shared/types/pubsub.types";
import { WorkflowOperator } from "../services/workflow-service";
import { PipelineCommandHandler } from "../services/command-handler";

export async function handleRegenerateSceneCommand(
    command: Extract<PipelineCommand, { type: "REGENERATE_SCENE"; }>,
    workflowOperator: WorkflowOperator,
) {
    const { projectId, payload } = command;
    console.log(`[handleRegenerateSceneCommand] Regenerating scene ${payload.sceneId} for projectId: ${projectId}`);

    try {
        const job = await PipelineCommandHandler.handleRegenerateScene(command);
        console.log(`[handleRegenerateSceneCommand] Created job ${job.id}`);

        // Broadcast state change (status: generating)
        await workflowOperator.getProjectState(projectId);
    } catch (error) {
        console.error(`[handleRegenerateSceneCommand] Error regenerating scene for ${projectId}:`, error);
    }
}
