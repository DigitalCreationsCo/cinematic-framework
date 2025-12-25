import { PipelineCommand } from "../../shared/pubsub-types";
import { WorkflowService } from "../workflow-service";

export async function handleResumePipelineCommand(
    command: Extract<PipelineCommand, { type: "RESUME_PIPELINE"; }>,
    workflowService: WorkflowService,
) {
    const { projectId } = command;
    console.log(`[handleResumePipelineCommand] Resuming pipeline for projectId: ${projectId}`);

    try {
        await workflowService.resumePipeline(projectId);
    } catch (error) {
         console.error(`[handleResumePipelineCommand] Error resuming pipeline for ${projectId}:`, error);
    }
}
