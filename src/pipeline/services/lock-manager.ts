import { PoolManager } from './pool-manager';

interface LockOptions {
    lockTimeout?: number;
    heartbeatInterval?: number;
    lockTTL?: number;
}

interface LockInfo {
    workerId: string;
    acquiredAt: Date;
    renewedAt: Date;
    expiresAt: Date;
    version: number;
}

export class DistributedLockManager {
    private poolManager: PoolManager;
    private activeLocks: Map<string, NodeJS.Timeout> = new Map();
    private workerId: string;

    constructor(poolManager: PoolManager, workerId: string) {
        this.workerId = workerId;

        poolManager.on('circuit-open', () => {
            console.error('[LockManager] WARNING: Database connection pool circuit breaker opened!');
            // Release all locks as we can't maintain them
            this.releaseAllLocksNoDb();
        });

        poolManager.on('connection-leak', (info) => {
            console.error('[LockManager] Connection leak detected:', info);
        });

        poolManager.on('metrics', (metrics) => {
            if (metrics.waitingClients > 5) {
                console.warn(`[LockManager] Pool under pressure: ${metrics.waitingClients} clients waiting`);
            }
        });

        this.poolManager = poolManager;
    }

    async init() {
        try {
            await this.poolManager.query(`
                CREATE TABLE IF NOT EXISTS project_locks (
                    project_id TEXT PRIMARY KEY,
                    worker_id TEXT NOT NULL,
                    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMPTZ NOT NULL,
                    lock_version INTEGER NOT NULL DEFAULT 1,
                    metadata JSONB DEFAULT '{}'::jsonb
                );

                CREATE INDEX IF NOT EXISTS idx_locks_expires ON project_locks(expires_at);
                CREATE INDEX IF NOT EXISTS idx_locks_worker ON project_locks(worker_id);
            `);

            await this.poolManager.query(`
                CREATE OR REPLACE FUNCTION cleanup_expired_locks()
                RETURNS TABLE(cleaned_project_id TEXT, cleaned_worker_id TEXT) AS $$
                BEGIN
                RETURN QUERY
                DELETE FROM project_locks 
                WHERE expires_at < NOW()
                RETURNING project_id, worker_id;
                END;
                $$ LANGUAGE plpgsql;
            `);

            console.log('[LockManager] Initialized successfully');
        } catch (error: any) {
            console.error('[LockManager] Initialization failed:', error.message);
            throw error;
        }
    }

    /**
   * Acquire lock with zero-connection-leak guarantee
   */
    async acquireLock(
        projectId: string,
        options: LockOptions = {}
    ): Promise<boolean> {
        const {
            lockTimeout = 5000,
            heartbeatInterval = 10000,
            lockTTL = 30000,
        } = options;

        if (heartbeatInterval >= lockTTL) {
            throw new Error("heartbeatInterval must be significantly less than lockTTL");
        }
        
        // Check circuit breaker state first
        if (this.poolManager.getCircuitState() === 'open') {
            console.warn('[LockManager] Cannot acquire lock - circuit breaker is open');
            return false;
        }

        try {
            // Clean up expired locks first (uses auto-managed connection)
            const cleanupResult = await this.poolManager.query('SELECT * FROM cleanup_expired_locks()');
            if (cleanupResult.rowCount && cleanupResult.rowCount > 0) {
                console.log(`[LockManager] Cleaned up ${cleanupResult.rowCount} expired locks`);
            }

            const expiresAt = new Date(Date.now() + lockTTL);

            // Try to acquire lock (uses auto-managed connection)
            const result = await this.poolManager.query(
                `
        INSERT INTO project_locks (project_id, worker_id, expires_at, metadata)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_id) DO UPDATE
        SET 
          worker_id = EXCLUDED.worker_id,
          renewed_at = NOW(),
          expires_at = EXCLUDED.expires_at,
          lock_version = project_locks.lock_version + 1,
          metadata = EXCLUDED.metadata
        WHERE 
          project_locks.worker_id = $2 
          OR project_locks.expires_at < NOW()
        RETURNING lock_version, worker_id
        `,
                [ projectId, this.workerId, expiresAt, { acquiredBy: this.workerId } ]
            );

            if (result.rowCount === 0) {
                const lockInfo = await this.getLockInfo(projectId);
                console.log(
                    `[LockManager] Failed to acquire lock for ${projectId}. ` +
                    `Held by ${lockInfo?.workerId}, expires in ${lockInfo ? Math.round((lockInfo.expiresAt.getTime() - Date.now()) / 1000) : '?'}s`
                );
                return false;
            }

            const version = result.rows[ 0 ].lock_version;
            console.log(`[LockManager] Acquired lock for ${projectId} (v${version})`);

            // Start heartbeat (no connection held)
            this.startHeartbeat(projectId, lockTTL, heartbeatInterval);

            return true;

        } catch (error: any) {
            console.error(`[LockManager] Error acquiring lock for ${projectId}:`, error.message);

            // Provide helpful context
            if (error.message.includes('Pool exhausted')) {
                console.error('[LockManager] Pool exhaustion detected. Active connections:',
                    this.poolManager.getMetrics().totalConnections);
            }

            return false;
        }
    }

    /**
   * Heartbeat that doesn't hold connections
   */
    private startHeartbeat(
        projectId: string,
        lockTTL: number,
        interval: number
    ) {
        this.stopHeartbeat(projectId);

        const heartbeat = setInterval(async () => {
            // Skip if circuit breaker is open
            if (this.poolManager.getCircuitState() === 'open') {
                console.warn(`[LockManager] Skipping heartbeat for ${projectId} - circuit breaker open`);
                this.stopHeartbeat(projectId);
                return;
            }

            try {
                const expiresAt = new Date(Date.now() + lockTTL);

                // Heartbeat query uses auto-managed connection
                const result = await this.poolManager.query(
                    `
          UPDATE project_locks
          SET renewed_at = NOW(), expires_at = $1
          WHERE project_id = $2 AND worker_id = $3
          RETURNING lock_version
          `,
                    [ expiresAt, projectId, this.workerId ]
                );

                if (result.rowCount === 0) {
                    console.warn(`[LockManager] Lost lock for ${projectId} during heartbeat`);
                    this.stopHeartbeat(projectId);
                } else {
                    const version = result.rows[ 0 ].lock_version;
                    console.log(`[LockManager] Renewed lock for ${projectId} (v${version})`);
                }
            } catch (error: any) {
                console.error(`[LockManager] Heartbeat error for ${projectId}:`, error.message);

                // Don't stop heartbeat on temporary errors, but warn
                if (error.message.includes('circuit breaker')) {
                    this.stopHeartbeat(projectId);
                }
            }
        }, interval);

        this.activeLocks.set(projectId, heartbeat);
    }

    private stopHeartbeat(projectId: string) {
        const heartbeat = this.activeLocks.get(projectId);
        if (heartbeat) {
            clearInterval(heartbeat);
            this.activeLocks.delete(projectId);
        }
    }

    /**
   * Release lock with guaranteed connection cleanup
   */
    async releaseLock(projectId: string): Promise<void> {
        this.stopHeartbeat(projectId);

        try {
            // Release query uses auto-managed connection
            const result = await this.poolManager.query(
                'DELETE FROM project_locks WHERE project_id = $1 AND worker_id = $2 RETURNING lock_version',
                [ projectId, this.workerId ]
            );

            if (result.rowCount && result.rowCount > 0) {
                console.log(`[LockManager] Released lock for ${projectId}`);
            }
        } catch (error: any) {
            console.error(`[LockManager] Error releasing lock for ${projectId}:`, error.message);
            // Don't throw - we still stopped the heartbeat
        }
    }

    /**
     * Check lock ownership
     */
    async hasLock(projectId: string): Promise<boolean> {
        try {
            const result = await this.poolManager.query(
                `
        SELECT worker_id 
        FROM project_locks 
        WHERE project_id = $1 AND worker_id = $2 AND expires_at > NOW()
        `,
                [ projectId, this.workerId ]
            );

            return result.rowCount !== null && result.rowCount > 0;
        } catch (error: any) {
            console.error(`[LockManager] Error checking lock for ${projectId}:`, error.message);
            return false;
        }
    }

    /**
     * Get lock information
     */
    async getLockInfo(projectId: string): Promise<LockInfo | null> {
        try {
            const result = await this.poolManager.query(
                `
        SELECT worker_id, acquired_at, renewed_at, expires_at, lock_version
        FROM project_locks
        WHERE project_id = $1 AND expires_at > NOW()
        `,
                [ projectId ]
            );

            if (result.rowCount === 0) return null;

            return {
                workerId: result.rows[ 0 ].worker_id,
                acquiredAt: result.rows[ 0 ].acquired_at,
                renewedAt: result.rows[ 0 ].renewed_at,
                expiresAt: result.rows[ 0 ].expires_at,
                version: result.rows[ 0 ].lock_version,
            };
        } catch (error: any) {
            console.error(`[LockManager] Error getting lock info for ${projectId}:`, error.message);
            return null;
        }
    }

    /**
     * Force release lock
     */
    async forceRelease(projectId: string): Promise<void> {
        try {
            await this.poolManager.query(
                'DELETE FROM project_locks WHERE project_id = $1',
                [ projectId ]
            );
            console.log(`[LockManager] Force released lock for ${projectId}`);
        } catch (error: any) {
            console.error(`[LockManager] Error force releasing lock for ${projectId}:`, error.message);
        }
    }

    /**
     * Release all locks held by this worker
     */
    async releaseAllLocks(): Promise<void> {
        // Stop all heartbeats first (doesn't use DB)
        for (const projectId of this.activeLocks.keys()) {
            this.stopHeartbeat(projectId);
        }

        try {
            const result = await this.poolManager.query(
                'DELETE FROM project_locks WHERE worker_id = $1 RETURNING project_id',
                [ this.workerId ]
            );

            if (result.rowCount && result.rowCount > 0) {
                const projects = result.rows.map(r => r.project_id).join(', ');
                console.log(`[LockManager] Released ${result.rowCount} locks for worker ${this.workerId}: ${projects}`);
            }
        } catch (error: any) {
            console.error('[LockManager] Error releasing all locks:', error.message);
        }
    }

    /**
     * Release locks without DB access (for circuit breaker scenarios)
     */
    private releaseAllLocksNoDb(): void {
        console.log('[LockManager] Releasing all locks locally (no DB access)');
        for (const projectId of this.activeLocks.keys()) {
            this.stopHeartbeat(projectId);
        }
    }

    /**
     * Get my locks
     */
    async getMyLocks(): Promise<string[]> {
        try {
            const result = await this.poolManager.query(
                'SELECT project_id FROM project_locks WHERE worker_id = $1 AND expires_at > NOW()',
                [ this.workerId ]
            );
            return result.rows.map(r => r.project_id);
        } catch (error: any) {
            console.error('[LockManager] Error getting my locks:', error.message);
            return [];
        }
    }

    /**
     * Get pool health metrics
     */
    getPoolMetrics() {
        return this.poolManager.getMetrics();
    }

    /**
     * Check if lock manager is healthy
     */
    isHealthy(): boolean {
        return this.poolManager.isHealthy() &&
            this.poolManager.getCircuitState() !== 'open';
    }

    /**
     * Close and cleanup
     */
    async close() {
        console.log('[LockManager] Initiating graceful shutdown...');

        // 1. Stop all local heartbeats immediately to prevent renewal
        for (const projectId of this.activeLocks.keys()) {
            this.stopHeartbeat(projectId);
        }

        // 2. Release all locks in the DB (needs the pool to be alive!)
        try {
            await this.releaseAllLocks();
        } catch (error) {
            console.error('[LockManager] Failed to release locks during close:', error);
        }

        console.log('[LockManager] Lock cleanup complete.');
    }
}
