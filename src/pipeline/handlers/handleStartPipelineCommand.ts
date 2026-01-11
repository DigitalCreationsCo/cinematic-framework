import { PipelineCommand } from "../../shared/types/pubsub.types";
import { WorkflowOperator } from "../services/workflow-service";


export async function handleStartPipelineCommand(
    command: Extract<PipelineCommand, { type: "START_PIPELINE"; }>,
    workflowOperator: WorkflowOperator,
) {
    console.log(`[handleStartPipelineCommand] Starting pipeline for projectId: ${command.projectId}`);
    const { projectId, payload } = command;
    try {

        await workflowOperator.startPipeline(projectId!, payload);
    } catch (error) {
        console.error(`[handleStartPipelineCommand] Error starting pipeline for ${projectId}:`, error);
        // Error handling is mostly done inside WorkflowOperator/stream-helper, but we catch top-level failures here
    }
}
