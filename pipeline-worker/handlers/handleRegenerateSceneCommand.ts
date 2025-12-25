import { PipelineCommand } from "../../shared/pubsub-types";
import { WorkflowService } from "../workflow-service";

export async function handleRegenerateSceneCommand(
    command: Extract<PipelineCommand, { type: "REGENERATE_SCENE"; }>,
    workflowService: WorkflowService,
) {
    const { projectId, payload } = command;
    console.log(`[handleRegenerateSceneCommand] Regenerating scene ${payload.sceneId} for projectId: ${projectId}`);

    try {
        await workflowService.regenerateScene(projectId, payload.sceneId, payload.forceRegenerate || false, payload.promptModification);
    } catch (error) {
        console.error(`[handleRegenerateSceneCommand] Error regenerating scene for ${projectId}:`, error);
    }
}
