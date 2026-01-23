// src/workflow/graph.ts
import * as dotenv from "dotenv";
dotenv.config();
import { StateGraph, END, START, NodeInterrupt, Command, interrupt, Send } from "@langchain/langgraph";
import { JobEvent, JobRecord, JobType } from "../shared/types/job.types";
import {
    AssetKey,
    LlmRetryInterruptValue,
} from "../shared/types/workflow.types";
import { JobControlPlane } from "src/pipeline/services/job-control-plane";



export type JobPayload<T = JobType> =
    Extract<JobRecord, { type: T; }>[ 'payload' ] extends undefined
    ? [ payload?: undefined ]
    : [ payload: Extract<JobRecord, { type: T; }>[ 'payload' ] ];

export type BatchJobs<T extends JobType = JobType> = (
    Pick<Extract<JobRecord, { type: T; }>, "type" | "uniqueKey" | "assetKey">
    & { payload: JobPayload<T>[ 0 ]; }
)[];

export class Dispatcher {

    constructor(
        private projectId: string,
        private MAX_PARALLEL_JOBS: number,
        private jobControlPlane: JobControlPlane,
    ) { }

    async ensureJob<T extends JobType>(
        nodeName: string,
        jobType: T,
        // payload: Extract<JobRecord, { type: T; }>[ 'payload' ],
        assetKey: AssetKey,
        ...payloadArg: JobPayload<T>
    ): Promise<Extract<JobRecord, { type: T; }> | undefined> {

        const [ payload ] = payloadArg;
        // 1. Fetch the latest job for this project + type + logic scoping
        // We use nodeName as the uniqueKey for singleton jobs to ensure they are addressed correctly.
        const job = await this.jobControlPlane.getLatestJob(this.projectId, jobType, nodeName);

        // use the nodeName/uniqueKey for logical lookup.
        const logicalKey = nodeName;

        const interruptValue: LlmRetryInterruptValue = {
            type: "waiting_for_job",
            error: "waiting_for_job",
            errorDetails: { jobId: job?.id, logicalKey },
            functionName: "ensureJob",
            nodeName,
            projectId: this.projectId,
            attempt: job?.attempt || 1,
            lastAttemptTimestamp: new Date().toISOString(),
        };

        if (!job) {
            // 3. Create initial job if none exists
            // We omit the 'id' to let it generate a random uuidv7 PK.
            // The 'uniqueKey' is our stable address for find/recover.
            await this.jobControlPlane.createJob({
                type: jobType,
                projectId: this.projectId,
                payload,
                uniqueKey: nodeName,
                assetKey: assetKey,
            });
            console.log(`[${nodeName}] Dispatched job for ${nodeName}`);
            interrupt(interruptValue);
        }

        // 4. Handle existing job states
        if (job?.state === 'COMPLETED') {
            return job as Extract<JobRecord, { type: T; }>;
        }

        if (job?.state === 'FAILED') {
            // 5. Normal Retry: If failed but we have retries left, requeue the SAME record
            if (job.attempt < job.maxRetries) {
                console.log(`[${nodeName}] Job ${job.id} failed (Attempt ${job.attempt}/${job.maxRetries}). Requeueing...`);
                await this.jobControlPlane.requeueJob(job.id, job.attempt, 'BACKOFF_RETRY');
                interrupt(interruptValue);
            }

            // 6. Option 2 "Way Through": If we are here, retries are exhausted.
            throw new Error(`Job ${job.id} failed and exhausted all ${job.maxRetries} retries. To reset, a new job record with the same uniqueKey must be created.`);
        }

        // Still RUNNING, CREATED, or other non-terminal states
        interrupt(interruptValue);
    }

    async ensureBatchJobs<T extends JobType>(
        nodeName: string,
        jobs: BatchJobs<T>,
    ): Promise<Extract<JobRecord, { type: T; }>[]> {
        let completedJobs: Extract<JobRecord, { type: T; }>[] = [];
        const missingJobs: typeof jobs = [];
        const failedJobs: { id: string; attempt: number; error: string; }[] = [];
        let runningCount = 0;

        // 1. Check status of all requested jobs using 'getLatestJob' for logical addressing
        for (const jobRequest of jobs) {
            // For batch jobs, we treat the 'id' field as the uniqueKey (the logical address)
            const job = await this.jobControlPlane.getLatestJob(this.projectId, jobRequest.type, jobRequest.uniqueKey);

            if (!job) {
                missingJobs.push(jobRequest);
            } else if (job.state === 'COMPLETED') {
                completedJobs.push(job as Extract<JobRecord, { type: T; }>);
            } else if (job.state === 'FAILED') {
                failedJobs.push({ id: job.id, attempt: job.attempt, error: job.error || "Unknown error" });
            } else {
                // PENDING or RUNNING
                runningCount++;
            }
        }

        // 2. Handle Aggregated Failures
        if (failedJobs.length > 0) {
            const errorMsg = `${failedJobs.length} jobs failed in batch: ${failedJobs.map(f => f.id).join(', ')}`;
            console.error(`[${nodeName}] ${errorMsg}`);

            // aggregated failure interrupt
            const interruptValue: LlmRetryInterruptValue = {
                type: "llm_retry_exhausted",
                error: errorMsg,
                errorDetails: { failedJobs },
                functionName: "ensureBatchJobs",
                nodeName: nodeName,
                projectId: this.projectId,
                params: {
                    jobIds: failedJobs.map(f => f.id)
                },
                attempt: failedJobs[ 0 ].attempt,
                lastAttemptTimestamp: new Date().toISOString(),
            };

            interrupt(interruptValue);
        }

        // 3. Throttling & Creation
        const slotsAvailable = this.MAX_PARALLEL_JOBS - runningCount;

        if (missingJobs.length > 0) {
            // Only start as many as we have slots for
            const jobsToStart = missingJobs.slice(0, slotsAvailable);

            if (jobsToStart.length > 0) {
                console.log(`[${nodeName}] Starting ${jobsToStart.length} new jobs (Throttling: ${runningCount}/${this.MAX_PARALLEL_JOBS} active)`);

                for (const jobRequest of jobsToStart) {
                    await this.jobControlPlane.createJob({
                        ...jobRequest,
                        projectId: this.projectId,
                        uniqueKey: jobRequest.uniqueKey,
                    });
                    runningCount++;
                }
            }
        }

        // 4. Wait if any are running or if we still have missing jobs (queued)
        const notCompletedCount = missingJobs.length;

        if (notCompletedCount > 0) {
            console.log(`[${nodeName}] Waiting for ${notCompletedCount} jobs (${runningCount} running, ${jobs.length - completedJobs.length - runningCount} pending start)...`);
            const interruptValue: LlmRetryInterruptValue = {
                type: "waiting_for_batch",
                error: `Waiting for ${notCompletedCount} batch jobs to complete`,
                errorDetails: { pendingJobs: notCompletedCount },
                functionName: "ensureBatchJobs",
                nodeName: nodeName,
                projectId: this.projectId,
                attempt: 1, // TODO Possibly fix this if it adds value for the user
                lastAttemptTimestamp: new Date().toISOString(),
            };
            interrupt(interruptValue);
        }

        return completedJobs;
    }
}