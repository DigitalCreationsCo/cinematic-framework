import { PipelineCommand } from "../../shared/pubsub-types";
import { WorkflowService } from "../workflow-service";

export async function handleStartPipelineCommand(
    command: Extract<PipelineCommand, { type: "START_PIPELINE"; }>,
    workflowService: WorkflowService,
) {
    const { projectId, payload } = command;

    console.log(`[handleStartPipelineCommand] Starting pipeline for projectId: ${projectId}`);

    try {
        await workflowService.startPipeline(projectId, payload);
    } catch (error) {
        console.error(`[handleStartPipelineCommand] Error starting pipeline for ${projectId}:`, error);
        // Error handling is mostly done inside WorkflowService/stream-helper, but we catch top-level failures here
    }
}
