import { PipelineCommand } from "../../shared/pubsub-types";
import { WorkflowService } from "../workflow-service";

export async function handleRequestFullStateCommand(
    command: Extract<PipelineCommand, { type: "REQUEST_FULL_STATE"; }>,
    workflowService: WorkflowService,
) {
    const { projectId } = command;
    try {
        await workflowService.getFullState(projectId);
    } catch (error) {
        console.error("Error handling REQUEST_FULL_STATE:", error);
    }
}
