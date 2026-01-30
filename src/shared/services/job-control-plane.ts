import { PoolManager } from "./pool-manager.js";
import { db, schema } from "../db/index.js";
import { eq, and, sql, desc, count, isNull } from "drizzle-orm";
import { createHash } from 'crypto';
import { JobState, JobEvent, JobType, JobRecord } from "../types/job.types.js";
import { jobs } from "../db/schema.js";



/**
 * Manages the lifecycle and persistence of background jobs.
 * Handles atomic state transitions, concurrency limits, and data serialization.
 */
export class JobControlPlane {

    /** @internal Regex used to identify and revive ISO 8601 date strings from JSONB results. */
    private static ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d*)?Z$/;

    /**
     * @param poolManager - The managed connection pool with circuit-breaking capabilities.
     * @param publishJobEvent - Callback to broadcast job state changes to the system.
     */
    constructor(
        private poolManager: PoolManager,
        private publishJobEvent: (evt: JobEvent) => Promise<void>,
    ) { }

    /**
     * Deeply traverses an object to convert ISO strings back to JavaScript Date objects.
     * Resolves the "JSON Date Bug" where dates are lost during DB serialization.
     * @param obj - The object or value to revive.
     * @returns The object with stringified dates restored as Date instances.
     */
    private reviveDates(obj: any): any {
        if (obj === null || typeof obj !== 'object') {
            if (typeof obj === "string" && JobControlPlane.ISO_DATE_REGEX.test(obj)) {
                return new Date(obj);
            }
            return obj;
        }
        for (const key in obj) {
            obj[ key ] = this.reviveDates(obj[ key ]);
        }
        return obj;
    }

    /**
     * Maps a UUID string to a signed 32-bit integer for Postgres advisory locking.
     * @param input - The UUID or string to hash.
     * @returns A 32-bit integer.
     * Risk: MD5 hashes to 128-bit; forcing it into 32-bit (Int32Array) has a non-negligible collision risk in a high-scale system.
     * Improvement: Use pg_advisory_xact_lock(bigint) (64-bit) instead. Use hashTo64BitInt function and a single 64-bit key to reduce the collision space by $2^{32}$.
     */
    private hashTo32BitInt(input: string): number {
        const hash = createHash('md5').update(input).digest('hex');
        return Int32Array.from([ parseInt(hash.substring(0, 8), 16) ])[ 0 ];
    }

    /**
     * Converts a UUID (or any string) into a 64-bit BigInt for Postgres Advisory Locks.
     * Postgres requires a signed 64-bit integer.
     */
    private hashTo64BitInt(uuid: string): bigint {
        const hash = createHash('sha256').update(uuid).digest('hex');
        const hex64 = hash.substring(0, 16);
        return BigInt(`0x${hex64}`) - (BigInt(1) << BigInt(63));
    }

    async createJob(job: Omit<JobRecord, "id" | "state" | "attempt" | "maxRetries" | "createdAt" | "updatedAt" | "result" | "error"> & { id?: string; maxRetries?: number; attempt?: number; uniqueKey?: string; }) {
        const [ newJob ] = await db.insert(jobs).values({
            id: job.id, // Primary Key - can still be deterministic for safety or random for audit trail
            type: job.type,
            projectId: job.projectId,
            state: "CREATED",
            payload: job.payload,
            uniqueKey: job.uniqueKey,
            assetKey: job.assetKey,
            attempt: job.attempt,
            maxRetries: job.maxRetries,
        }).returning();

        console.info({ job: newJob }, `Job created`);

        await this.publishJobEvent({
            type: "JOB_DISPATCHED",
            jobId: newJob.id,
            projectId: newJob.projectId,
        });

        return newJob as JobRecord;
    }

    async getJob(jobId: string): Promise<JobRecord | null> {

        const [ row ] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (!row) return null;

        if (row && row.result) {
            row.result = this.reviveDates(row.result);
        }
        return row as JobRecord;
    }

    /**
     * Fetches the latest job attempt for a given project and type.
     * Scoped by uniqueKey for parallel/batch jobs.
     */
    async getLatestJob(projectId: string, type: JobType, uniqueKey?: string): Promise<JobRecord | null> {
        const conditions = [
            eq(jobs.projectId, projectId),
            eq(jobs.type, type)
        ];

        if (uniqueKey) {
            conditions.push(eq(jobs.uniqueKey, uniqueKey));
        } else {
            // For singleton jobs, ensure we aren't matching a batch job
            conditions.push(sql`${jobs.uniqueKey} IS NULL`);
        }

        const [ row ] = await db.select()
            .from(jobs)
            .where(and(...conditions))
            .orderBy(desc(jobs.createdAt)) // Matches optimized composite index
            .limit(1);

        if (!row) return null;
        if (row.result) {
            row.result = this.reviveDates(row.result);
        }
        return row as JobRecord;
    }


    /**
     * Claims a job when only the jobId is known. 
     * @param jobId - Unique ID of the job to claim.
     * @returns A tuple of [JobRecord, string (ISO timestamp)] or null.
     */
    async claimJob(jobId: string): Promise<[ JobRecord, string ] | null> {

        return await db.transaction(async (tx) => {
            const jobKey = this.hashTo64BitInt(jobId);

            // Acquire advisory lock and fetch job in one query
            const lockResult = await tx.execute(
                sql`SELECT pg_try_advisory_xact_lock(${jobKey}) as locked`
            );

            if (!lockResult.rows[ 0 ]?.locked) return null;

            // Fetch job and check concurrent jobs in parallel
            const limit = parseInt(process.env.MAX_CONCURRENT_JOBS_PER_WORKFLOW || "10", 10);

            const [ jobResult, countResult ] = await Promise.all([
                tx
                    .select({ projectId: jobs.projectId })
                    .from(jobs)
                    .where(eq(jobs.id, jobId))
                    .limit(1),
                tx
                    .select({ count: sql<number>`count(*)` })
                    .from(jobs)
                    .where(and(
                        eq(jobs.projectId, sql`(SELECT project_id FROM jobs WHERE id = ${jobId})`),
                        eq(jobs.state, "RUNNING")
                    ))
            ]);

            if (jobResult.length === 0) return null;

            const [ { count } ] = countResult;
            if (count >= limit) return null;

            // Claim the job
            const claimTime = new Date();

            const [ claimedJob ] = await tx
                .update(jobs)
                .set({
                    state: "RUNNING",
                    updatedAt: claimTime
                })
                .where(and(eq(jobs.id, jobId), eq(jobs.state, "CREATED")))
                .returning();

            if (!claimedJob) return null;

            const revivedJob = this.reviveDates(claimedJob);

            return [ revivedJob, claimTime.toISOString() ];
        });
    }

    /**
     * Resets a job to CREATED state and dispatches a notification.
     * Includes audit logging to track whether this was a recovery or a retry.
     * * @param jobId - The ID of the job to requeue.
     * @param currentAttempt - The current attempt for optimistic locking.
     * @param context - The monitor context (e.g., 'STALE_RECOVERY' or 'BACKOFF_RETRY').
     */
    async requeueJob(jobId: string, currentAttempt: number, context: 'STALE_RECOVERY' | 'BACKOFF_RETRY'): Promise<void> {
        const auditLog = ` [Monitor] Action: ${context} at ${new Date().toISOString()}`;

        const result = await this.updateJobSafeAndIncrementAttempt(jobId, currentAttempt, {
            state: "CREATED",
            error: sql<string>`COALESCE(${jobs.error}, '') || ${auditLog}` as any,
        });

        if (result) {
            await this.publishJobEvent({
                type: "JOB_DISPATCHED",
                jobId: result.id,
                projectId: result.projectId,
            });
            console.log({ functionName: this.requeueJob.name, auditLog: auditLog.trim(), job: result }, `Requeued with new attempt`);
        } else {
            console.warn({ functionName: this.requeueJob.name, auditLog: auditLog.trim(), job: result }, `Race condition avoided: Job already updated by worker.`);
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
                attempt: sql`CASE WHEN ${jobs.state} = 'FAILED' THEN ${jobs.attempt} + 1 ELSE ${jobs.attempt} END`
            })
            .where(eq(jobs.id, jobId));
        console.log(`[JobControlPlane] Updated job ${jobId} to state ${state}`);
    }

    /**
     * Updates job data using an Optimistic Locking pattern via the 'attempt' column.
     * Ensures that a worker cannot overwrite a job that has been retried or cancelled elsewhere.
     * * @param jobId - ID of the job to update.
     * @param currentAttempt - The version (attempt count) the worker expects to update.
     * @param updates - Partial job data to apply.
     * @throws {Error} If the job attempt has changed, indicating a concurrent modification.
     * @returns The updated JobRecord.
     */
    async updateJobSafe(
        jobId: string,
        currentAttempt: number,
        updates?: Partial<JobRecord>,
    ) {
        const [ result ] = await db.update(jobs)
            .set({
                ...updates,
                updatedAt: new Date(),
            })
            .where(and(
                eq(jobs.id, jobId),
                eq(jobs.attempt, currentAttempt) // Guard: only update if attempt matches
            ))
            .returning();

        if (!result) {
            console.warn(`OptimisticLockError: Job ${jobId} was not updated. It was possibly updated by another process.`);
            return null;
        }

        return this.reviveDates(result) as JobRecord;
    }

    /**
     * Updates job data using an Optimistic Locking pattern via the 'attempt' column.
     * Ensures that a worker cannot overwrite a job that has been retried or cancelled elsewhere.
     * * @param jobId - ID of the job to update.
     * @param currentAttempt - The version (attempt count) the worker expects to update.
     * @param updates - Partial job data to apply.
     * @throws {Error} If the job attempt has changed, indicating a concurrent modification.
     * @returns The updated JobRecord.
     */
    async updateJobSafeAndIncrementAttempt(
        jobId: string,
        currentAttempt: number,
        updates?: Partial<typeof jobs.$inferInsert>
    ) {
        // Remove 'attempt' from updates if it was passed in to prevent double-increment
        const { attempt, ...rest } = updates || {};

        const [ result ] = await db.update(jobs)
            .set({
                ...rest,
                attempt: sql`${jobs.attempt} + 1`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(jobs.id, jobId),
                eq(jobs.attempt, currentAttempt) // Guard: only update if attempt matches
            ))
            .returning();

        if (!result) {
            console.warn(`OptimisticLockError: Job ${jobId} was not updated. It was possibly updated by another process.`);
            return null;
        }

        return this.reviveDates(result) as JobRecord;
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

    jobId = (projectId: string, node: string, uniqueKey?: string): string => {
        return uniqueKey
            ? `${projectId}-${node}-${uniqueKey}`
            : `${projectId}-${node}`;
    };
}
