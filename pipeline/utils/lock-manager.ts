import { Pool } from 'pg';

export class DistributedLockManager {
    private pool: Pool;

    constructor(connectionString: string) {
        this.pool = new Pool({ connectionString });
    }

    async init() {
        const client = await this.pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS project_locks (
                    project_id TEXT PRIMARY KEY,
                    worker_id TEXT NOT NULL,
                    acquired_at TIMESTAMPTZ DEFAULT NOW(),
                    expires_at TIMESTAMPTZ NOT NULL
                );
            `);
        } finally {
            client.release();
        }
    }

    async tryAcquire(projectId: string, workerId: string, ttlSeconds: number = 300): Promise<boolean> {
        const client = await this.pool.connect();
        try {
            // 1. Cleanup expired locks (optional, but keeps table clean)
            // We can rely on the ON CONFLICT logic, but deleting old ones is nice.
            // await client.query(`DELETE FROM project_locks WHERE expires_at < NOW()`);

            // 2. Try to acquire
            const query = `
                INSERT INTO project_locks (project_id, worker_id, expires_at)
                VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)
                ON CONFLICT (project_id)
                DO UPDATE SET
                    worker_id = $2,
                    expires_at = NOW() + ($3 || ' seconds')::interval,
                    acquired_at = NOW()
                WHERE project_locks.expires_at < NOW()
                RETURNING worker_id;
            `;
            
            const result = await client.query(query, [projectId, workerId, ttlSeconds]);
            
            // If a row is returned, we inserted or updated (acquired).
            // If no row is returned, the WHERE clause failed (valid lock exists).
            return result.rowCount !== null && result.rowCount > 0;

        } catch (error) {
            console.error("Error acquiring lock:", error);
            return false;
        } finally {
            client.release();
        }
    }

    async release(projectId: string, workerId: string): Promise<void> {
        const client = await this.pool.connect();
        try {
            // Only release if WE hold it
            await client.query(`
                DELETE FROM project_locks 
                WHERE project_id = $1 AND worker_id = $2
            `, [projectId, workerId]);
        } finally {
            client.release();
        }
    }

    async refresh(projectId: string, workerId: string, ttlSeconds: number = 300): Promise<boolean> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                UPDATE project_locks
                SET expires_at = NOW() + ($3 || ' seconds')::interval
                WHERE project_id = $1 AND worker_id = $2
            `, [projectId, workerId, ttlSeconds]);
            
            return result.rowCount !== null && result.rowCount > 0;
        } finally {
            client.release();
        }
    }

    async close() {
        await this.pool.end();
    }
}
