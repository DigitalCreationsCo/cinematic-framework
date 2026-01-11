import { JobEvent } from "../../shared/types/job-types";
import { JobControlPlane } from "../services/job-control-plane";
import { WorkflowOperator } from "../services/workflow-service";

export async function handleJobCompletion(
    jobId: string,
    workflowOperator: WorkflowOperator,
    jobControlPlane: JobControlPlane,
) {
    try {
        console.log(`[Pipeline] Handling completion for job ${jobId}`);
        const job = await jobControlPlane.getJob(jobId);
        if (!job || job.state !== "COMPLETED") {
            console.warn(`[Pipeline] Job ${jobId} not found or not completed`);
            return;
        }

        const { projectId } = job;
        console.log(`[Pipeline] Job ${jobId} (${job.type}) completed. Resuming pipeline for ${projectId}.`);
        await workflowOperator.resumePipeline(projectId);
    } catch (err) {
        console.error("[Pipeline] Error handling job completion:", err);
    }
}
