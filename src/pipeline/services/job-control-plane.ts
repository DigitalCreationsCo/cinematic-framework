import { JobState, JobEvent, JobType, JobRecord } from "../../shared/types/job-types";
import { PoolManager } from "./pool-manager";

export class JobControlPlane {
    private poolManager: PoolManager;
    publishJobEvent: (evt: JobEvent) => Promise<void>;

    constructor(
        poolManager: PoolManager,
        publishJobEvent: (evt: JobEvent) => Promise<void>
    ) {
        this.poolManager = poolManager;
        this.publishJobEvent = publishJobEvent;
    }

    async init() {
        await this.poolManager.query(`
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                project_id TEXT NOT NULL,
                state TEXT NOT NULL,
                payload JSONB NOT NULL,
                result JSONB,
                retry_count INTEGER DEFAULT 0,
                max_retries INTEGER DEFAULT 3,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                error TEXT
            );
        `);

        try {
            const checkRes = await this.poolManager.query(`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name='jobs' AND column_name='owner_id';
            `);

            if (checkRes.rows.length > 0) {
                console.log("[JobControlPlane] Migrating jobs table: owner_id -> project_id");
                await this.poolManager.query(`
                    ALTER TABLE jobs RENAME COLUMN owner_id TO project_id;
                `);
            }

            const checkOutputUri = await this.poolManager.query(`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name='jobs' AND column_name='output_uri';
            `);

            if (checkOutputUri.rows.length > 0) {
                console.log("[JobControlPlane] Migrating jobs table: dropping output_uri");
                await this.poolManager.query(`
                    ALTER TABLE jobs DROP COLUMN output_uri;
                `);
            }
        } catch (err) {
            console.warn("[JobControlPlane] Migration check failed:", err);
        }

        await this.poolManager.query(`
            DROP INDEX IF EXISTS idx_jobs_owner;
            CREATE INDEX IF NOT EXISTS idx_jobs_project_id ON jobs(project_id);
            CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
        `);
        console.log("[JobControlPlane] Initialized jobs table");
    }

    async createJob(job: Omit<JobRecord, "state" | "retryCount" | "maxRetries" | "createdAt" | "updatedAt" | "result" | "error"> & { maxRetries?: number; retryCount?: number; }) {
        const now = new Date().toISOString();
        const retryCount = job.retryCount ?? 0;
        const maxRetries = (job.maxRetries ?? 3) + retryCount;

        const newJob = {
            id: job.id,
            type: job.type,
            projectId: job.projectId,
            state: "CREATED",
            payload: job.payload,
            retryCount: retryCount,
            maxRetries: maxRetries,
            createdAt: now,
            updatedAt: now,
        } as JobRecord;

        const query = `
            INSERT INTO jobs (id, type, project_id, state, payload, retry_count, max_retries, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `;

        const values = [
            newJob.id,
            newJob.type,
            newJob.projectId,
            newJob.state,
            JSON.stringify(newJob.payload),
            newJob.retryCount,
            newJob.maxRetries,
            newJob.createdAt,
            newJob.updatedAt
        ];

        try {
            await this.poolManager.query(query, values);

            await this.publishJobEvent({
                type: "JOB_DISPATCHED",
                jobId: newJob.id
            });

            console.log(`[JobControlPlane] Created job ${newJob.id} for project ${newJob.projectId}`);
            return newJob;
        } catch (error) {
            console.error(`[JobControlPlane] Error creating job ${newJob.id}:`, error);
            throw error;
        }
    }

    async getJob<T>(jobId: string): Promise<Extract<JobRecord, { type: T; }> | null> {
        const query = `SELECT * FROM jobs WHERE id = $1`;
        const res = await this.poolManager.query(query, [ jobId ]);
        if (res.rows.length === 0) return null;
        return this.mapRowToJob(res.rows[ 0 ]) as Extract<JobRecord, { type: T; }>;
    }

    async claimJob(jobId: string, workerId: string): Promise<boolean> {
        const limit = parseInt(process.env.MAX_CONCURRENT_JOBS_PER_WORKFLOW || "5", 10);
        const query = `
            UPDATE jobs
            SET state = 'RUNNING', updated_at = NOW(), error = NULL
            WHERE id = $1 AND state = 'CREATED'
            AND (
                SELECT count(*) FROM jobs j2
                WHERE j2.project_id = jobs.project_id AND j2.state = 'RUNNING'
            ) < $2
        `;

        try {
            const result = await this.poolManager.query(query, [ jobId, limit ]);
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
        let query = `
            UPDATE jobs
            SET state = $1, updated_at = NOW()
        `;
        const values: any[] = [ state ];
        let paramIndex = 2;

        if (result !== undefined) {
            query += `, result = $${paramIndex}`;
            values.push(JSON.stringify(result));
            paramIndex++;
        }

        if (error !== undefined) {
            query += `, error = $${paramIndex}`;
            values.push(error);
            paramIndex++;
        }

        query += `, retry_count = CASE WHEN $1 = 'FAILED' THEN retry_count + 1 ELSE retry_count END`;

        query += ` WHERE id = $${paramIndex}`;
        values.push(jobId);

        await this.poolManager.query(query, values);
        console.log(`[JobControlPlane] Updated job ${jobId} to state ${state}`);
    }

    async listJobs(projectId: string): Promise<JobRecord[]> {
        const query = `SELECT * FROM jobs WHERE project_id = $1 ORDER BY created_at DESC`;
        const res = await this.poolManager.query(query, [ projectId ]);
        return res.rows.map(this.mapRowToJob);
    }

    async cancelJob(jobId: string): Promise<void> {
        await this.updateJobState(jobId, "CANCELLED");
        await this.publishJobEvent({
            type: "JOB_CANCELLED",
            jobId
        });
    }

    jobId = (projectId: string, node: string, attempt: number, uniqueKey?: string): string => {
        return uniqueKey
            ? `${projectId}-${node}-${uniqueKey}-${attempt}`
            : `${projectId}-${node}-${attempt}`;
    };

    async getLatestRetryCount(projectId: string, node: string, uniqueKey?: string): Promise<number> {
        const pattern = uniqueKey
            ? `${projectId}-${node}-${uniqueKey}-%`
            : `${projectId}-${node}-%`;

        const query = `
            SELECT MAX(retry_count) as max_retry
            FROM jobs
            WHERE project_id = $1
            AND id LIKE $2
        `;

        try {
            const res = await this.poolManager.query(query, [ projectId, pattern ]);
            if (res.rows.length === 0 || res.rows[ 0 ].max_retry === null) {
                return 0;
            }
            return parseInt(res.rows[ 0 ].max_retry, 10);
        } catch (error) {
            console.error(`[JobControlPlane] Error getting latest retry count for ${pattern}:`, error);
            return 0;
        }
    }

    private mapRowToJob(row: any): Extract<JobRecord, { type: typeof row.type; }> {
        return {
            id: row.id,
            type: row.type,
            projectId: row.project_id,
            state: row.state,
            payload: row.payload,
            result: row.result,
            retryCount: row.retry_count,
            maxRetries: row.max_retries,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            error: row.error
        };
    }
}
