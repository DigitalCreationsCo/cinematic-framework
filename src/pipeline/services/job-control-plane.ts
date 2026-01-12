import { JobState, JobEvent, JobType, JobRecord } from "../../shared/types/job-types";
import { PoolManager } from "./pool-manager";
import { v7 as uuidv7 } from "uuid";
import { db } from "../../shared/db";
import { eq, and, sql, desc, count } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { jobs } from "@shared/schema";

export class JobControlPlane {
    private poolManager: PoolManager;
    publishJobEvent: (evt: JobEvent) => Promise<void>;

    constructor(
        poolManager: PoolManager,
        publishJobEvent: (evt: JobEvent) => Promise<void>,
    ) {
        this.poolManager = poolManager;
        this.publishJobEvent = publishJobEvent;
        console.log("[JobControlPlane] Initialized.");
    }

    async createJob(job: Omit<JobRecord, "state" | "retryCount" | "maxRetries" | "createdAt" | "updatedAt" | "result" | "error"> & { maxRetries?: number; retryCount?: number; }) {
        const retryCount = job.retryCount ?? 0;
        const maxRetries = (job.maxRetries ?? 3) + retryCount;

        const [ newJob ] = await db.insert(jobs).values({
            id: job.id,
            type: job.type,
            projectId: job.projectId,
            state: "CREATED",
            payload: job.payload,
            retryCount: retryCount,
            maxRetries: maxRetries,
        }).returning();
 
            await this.publishJobEvent({
                type: "JOB_DISPATCHED",
                jobId: newJob.id
            });

        return newJob as JobRecord;
    }

    async getJob<T>(jobId: string): Promise<Extract<JobRecord, { type: T; }> | null> {

        const isoDateFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d*)?Z$/;
        function reviveDates(obj: any): any {
            if (obj === null || typeof obj !== 'object') {
                if (typeof obj === "string" && isoDateFormat.test(obj)) {
                    return new Date(obj);
                }
                return obj;
            }
            for (const key in obj) {
                obj[ key ] = reviveDates(obj[ key ]);
            }
            return obj;
        }

        const [ row ] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (row && row.result) {
            const parsed = typeof row.result === 'string'
                ? JSON.parse(row.result)
                : row.result;
            row.result = reviveDates(parsed);
        }
        return row as Extract<JobRecord, { type: T; }>;
    }

    async claimJob(jobId: string, workerId: string): Promise<boolean> {
        try {
            const limit = parseInt(process.env.MAX_CONCURRENT_JOBS_PER_WORKFLOW || "5", 10);

            // This uses a subquery for the concurrency check, matching your original logic
            const runningJobsCount = db
                .select({ value: count() })
                .from(jobs)
                .where(
                    and(
                        eq(jobs.projectId, sql`jobs.project_id`), // Reference outer table
                        eq(jobs.state, "RUNNING")
                    )
                );

            const result = await db.update(jobs)
                .set({
                    state: "RUNNING",
                    updatedAt: new Date()
                })
                .where(
                    and(
                        eq(jobs.id, jobId),
                        eq(jobs.state, "CREATED"),
                        sql`(${runningJobsCount}) < ${limit}`
                    )
                );

            if (result.rowCount === 1) {
                console.log(`[JobControlPlane] Job ${jobId} successfully claimed by worker ${workerId}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[JobControlPlane] Error claiming job ${jobId}:`, error);
            throw error;
        }
    }

    async updateJobState(jobId: string, state: JobState, result?: Record<string, any>, error?: string): Promise<void> {
        
        const jsonSafeResult = result
            ? JSON.parse(JSON.stringify(result))
            : null;
        await db.update(jobs)
            .set({
                state: state,
                result: jsonSafeResult, // Pass the object directly for jsonb
                error: error ?? null,
                updatedAt: new Date(),
                retryCount: sql`CASE WHEN ${jobs.state} = 'FAILED' THEN ${jobs.retryCount} + 1 ELSE ${jobs.retryCount} END`
            })
            .where(eq(jobs.id, jobId));
        console.log(`[JobControlPlane] Updated job ${jobId} to state ${state}`);
    }

    async listJobs(projectId: string): Promise<JobRecord[]> {
        const rows = await db
            .select()
            .from(jobs)
            .where(eq(jobs.projectId, projectId))
            .orderBy(desc(jobs.createdAt));

        return rows as JobRecord[];
    }

    async cancelJob(jobId: string): Promise<void> {
        await this.updateJobState(jobId, "CANCELLED");
        await this.publishJobEvent({ type: "JOB_CANCELLED", jobId });
    }

    jobId = (projectId: string, node: string, attempt: number, uniqueKey?: string): string => {
        return uniqueKey
            ? `${projectId}-${node}-${uniqueKey}-${attempt}`
            : `${projectId}-${node}-${attempt}`;
    };
}
