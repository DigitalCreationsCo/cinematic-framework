import { PipelineCommand } from "../../shared/pubsub-types";
import { WorkflowService } from "../services/workflow-service";

export async function handleRegenerateFrameCommand(
    command: Extract<PipelineCommand, { type: "REGENERATE_FRAME"; }>,
    workflowService: WorkflowService,
) {
    const { projectId, payload } = command;
    console.log(`Regenerating ${payload.frameType} frame for scene ${payload.sceneId} for projectId: ${projectId}`);
    
    try {
        await workflowService.regenerateFrame(
            projectId, 
            payload.sceneId, 
            payload.frameType, 
            payload.promptModification
        );
    } catch (error) {
        console.error(`Error regenerating frame for ${projectId}:`, error);
    }
}
