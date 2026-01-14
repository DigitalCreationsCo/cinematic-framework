import { db } from "../../shared/db";
import { jobs } from "../../shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { JobControlPlane } from "./job-control-plane";

export class JobLifecycleMonitor {
    private static instance: JobLifecycleMonitor;
    private isRunning: boolean = false;
    private interval: NodeJS.Timeout | null = null;

    private constructor(private jobControlPlane: JobControlPlane) { }

    public static getInstance(controlPlane: JobControlPlane): JobLifecycleMonitor {
        if (!JobLifecycleMonitor.instance) {
            JobLifecycleMonitor.instance = new JobLifecycleMonitor(controlPlane);
        }
        return JobLifecycleMonitor.instance;
    }

    public start(frequencyMs: number = 60000) {
        if (this.isRunning) return;
        this.isRunning = true;
        this.interval = setInterval(() => this.maintenanceCycle(), frequencyMs);
    }

    private async maintenanceCycle() {
        try {
            await Promise.all([
                this.processStaleJobs(),
                this.processRetryableJobs()
            ]);
        } catch (error) {
            console.error("[JobLifecycleMonitor] maintenanceCycle failed:", error);
        }
    }

    /**
     * RECOVERY: Finds jobs stuck in RUNNING.
     */
    private async processStaleJobs() {
        const staleJobs = await db.select({ id: jobs.id, attempt: jobs.attempt })
            .from(jobs)
            .where(and(
                eq(jobs.state, "RUNNING"),
                // Only touch jobs that haven't updated in 10 minutes
                sql`updated_at < NOW() - INTERVAL '10 minutes'`
            ));

        for (const job of staleJobs) {
            await this.jobControlPlane.requeueJob(job.id, job.attempt, 'STALE_RECOVERY');
        }
    }

    /**
     * RETRY: Finds jobs in FAILED state that have passed their backoff period.
     */
    private async processRetryableJobs() {
        const retryableJobs = await db.select({ id: jobs.id, attempt: jobs.attempt })
            .from(jobs)
            .where(and(
                eq(jobs.state, "FAILED"),
                // Backoff logic: 2^(attempt-1) minutes delay
                sql`updated_at < NOW() - (POWER(2, GREATEST(attempt - 1, 0)) * INTERVAL '1 minute')`
            ));

        for (const job of retryableJobs) {
            await this.jobControlPlane.requeueJob(job.id, job.attempt, 'BACKOFF_RETRY');
        }
    }

    public stop() {
        if (this.interval) clearInterval(this.interval!);
        this.isRunning = false;
    }
}