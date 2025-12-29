import { Pool, PoolClient, PoolConfig } from 'pg';
import { EventEmitter } from 'events';

interface PoolMetrics {
    totalConnections: number;
    idleConnections: number;
    waitingClients: number;
    acquisitionTimeMs: number;
    errors: number;
    lastError?: string;
    lastErrorTime?: Date;
}

interface PoolManagerConfig extends PoolConfig {
    // Circuit breaker settings
    errorThreshold?: number;
    resetTimeoutMs?: number;

    // Monitoring
    enableMetrics?: boolean;
    metricsIntervalMs?: number;

    // Connection health
    healthCheckIntervalMs?: number;
    maxConnectionAge?: number;

    // Leak detection
    connectionTimeoutMs?: number;
    warnOnSlowQueries?: boolean;
    slowQueryThresholdMs?: number;
}

/*
* Comprehensive connection pool management with monitoring and error handling
*/
export class PoolManager extends EventEmitter {
    private pool: Pool;
    private config: PoolManagerConfig;

    // Circuit breaker state
    private circuitState: 'closed' | 'open' | 'half-open' = 'closed';
    private errorCount: number = 0;
    private lastErrorTime?: Date;
    private circuitResetTimer?: NodeJS.Timeout;

    // Metrics
    private metrics: PoolMetrics = {
        totalConnections: 0,
        idleConnections: 0,
        waitingClients: 0,
        acquisitionTimeMs: 0,
        errors: 0,
    };

    // Connection tracking for leak detection
    private activeConnections: Map<PoolClient, {
        acquiredAt: Date;
        stack: string;
        queryCount: number;
    }> = new Map();

    private metricsInterval?: NodeJS.Timeout;
    private healthCheckInterval?: NodeJS.Timeout;
    private leakCheckInterval?: NodeJS.Timeout;

    constructor(config: PoolManagerConfig) {
        super();

        // Sensible defaults
        this.config = {
            max: 10, // Total pool size
            min: 2,  // Keep 2 connections warm
            idleTimeoutMillis: 30000, // Close idle after 30s
            connectionTimeoutMillis: 5000, // Fail fast if no connection available
            statement_timeout: 30000, // Kill queries after 30s
            query_timeout: 30000,

            // Circuit breaker
            errorThreshold: 5,
            resetTimeoutMs: 60000,

            // Monitoring
            enableMetrics: true,
            metricsIntervalMs: 10000,

            // Health checks
            healthCheckIntervalMs: 30000,
            maxConnectionAge: 3600000, // 1 hour

            // Leak detection
            warnOnSlowQueries: true,
            slowQueryThresholdMs: 5000,

            ...config,
        };

        this.pool = new Pool(this.config);
        this.setupPoolEventHandlers();

        if (this.config.enableMetrics) {
            this.startMetricsCollection();
        }

        if (this.config.healthCheckIntervalMs) {
            this.startHealthChecks();
        }

        this.startLeakDetection();
    }

    private setupPoolEventHandlers() {
        // Connection acquired
        this.pool.on('connect', (client: PoolClient) => {
            console.log('[Pool] New connection established');
            this.metrics.totalConnections++;
        });

        // Connection released back to pool
        this.pool.on('acquire', (client: PoolClient) => {
            console.log('[Pool] Connection acquired from pool');
        });

        // Connection removed from pool
        this.pool.on('remove', (client: PoolClient) => {
            console.log('[Pool] Connection removed from pool');
            this.metrics.totalConnections--;
        });

        // Error occurred
        this.pool.on('error', (err: Error, client: PoolClient) => {
            console.error('[Pool] Unexpected error on idle client:', err);
            this.handlePoolError(err);
        });
    }

    private handlePoolError(err: Error) {
        this.metrics.errors++;
        this.metrics.lastError = err.message;
        this.metrics.lastErrorTime = new Date();
        this.errorCount++;

        // Check if we should open the circuit breaker
        if (this.errorCount >= (this.config.errorThreshold || 5)) {
            this.openCircuit();
        }

        this.emit('error', err);
    }

    private openCircuit() {
        if (this.circuitState === 'open') return;

        console.error('[Pool] Circuit breaker OPENED - too many errors');
        this.circuitState = 'open';
        this.emit('circuit-open');

        // Schedule reset
        if (this.circuitResetTimer) {
            clearTimeout(this.circuitResetTimer);
        }

        this.circuitResetTimer = setTimeout(() => {
            console.log('[Pool] Circuit breaker entering HALF-OPEN state');
            this.circuitState = 'half-open';
            this.errorCount = 0;
            this.emit('circuit-half-open');
        }, this.config.resetTimeoutMs || 60000);
    }

    private closeCircuit() {
        if (this.circuitState === 'closed') return;

        console.log('[Pool] Circuit breaker CLOSED - system recovered');
        this.circuitState = 'closed';
        this.errorCount = 0;
        this.emit('circuit-closed');
    }

    /**
     * Get connection with comprehensive error handling
     */
    async getConnection(): Promise<PoolClient> {
        // Circuit breaker check
        if (this.circuitState === 'open') {
            throw new Error('Connection pool circuit breaker is OPEN - refusing connections');
        }

        const startTime = Date.now();

        try {
            // Try to get connection with timeout
            const client = await Promise.race([
                this.pool.connect(),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error('Connection acquisition timeout')),
                        this.config.connectionTimeoutMillis || 5000
                    )
                )
            ]);

            const acquisitionTime = Date.now() - startTime;
            this.metrics.acquisitionTimeMs = acquisitionTime;

            if (acquisitionTime > 1000) {
                console.warn(`[Pool] Slow connection acquisition: ${acquisitionTime}ms`);
            }

            // Track this connection for leak detection
            this.trackConnection(client);

            // Wrap release to ensure cleanup
            const originalRelease = client.release.bind(client);
            client.release = (err?: Error | boolean) => {
                this.untrackConnection(client);
                return originalRelease(err);
            };

            // If half-open, close circuit on success
            if (this.circuitState === 'half-open') {
                this.closeCircuit();
            }

            return client;

        } catch (error: any) {
            console.error('[Pool] Failed to acquire connection:', error.message);
            this.handlePoolError(error);

            // Provide helpful error message based on pool state
            if (error.message.includes('timeout')) {
                throw new Error(
                    `Pool exhausted: ${this.metrics.totalConnections}/${this.config.max} connections in use, ` +
                    `${this.metrics.waitingClients} clients waiting. ` +
                    `Consider: 1) Increasing pool size, 2) Optimizing queries, 3) Checking for connection leaks.`
                );
            }

            throw error;
        }
    }

    /**
     * Execute query with automatic connection management
     */
    async query<T = any>(text: string, params?: any[]) {
        const client = await this.getConnection();
        const startTime = Date.now();

        try {
            const result = await client.query(text, params);

            const queryTime = Date.now() - startTime;
            if (this.config.warnOnSlowQueries && queryTime > (this.config.slowQueryThresholdMs || 5000)) {
                console.warn(`[Pool] Slow query detected (${queryTime}ms):`, text.slice(0, 100));
            }

            return result;
        } finally {
            client.release();
        }
    }

    /**
     * Execute transaction with automatic rollback on error
     */
    async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.getConnection();

        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    private trackConnection(client: PoolClient) {
        const stack = new Error().stack || '';
        this.activeConnections.set(client, {
            acquiredAt: new Date(),
            stack,
            queryCount: 0,
        });
    }

    private untrackConnection(client: PoolClient) {
        this.activeConnections.delete(client);
    }

    private startMetricsCollection() {
        this.metricsInterval = setInterval(() => {
            this.updateMetrics();
            this.emit('metrics', this.metrics);
        }, this.config.metricsIntervalMs || 10000);
    }

    private updateMetrics() {
        this.metrics.idleConnections = this.pool.idleCount;
        this.metrics.waitingClients = this.pool.waitingCount;
        this.metrics.totalConnections = this.pool.totalCount;
    }

    private startHealthChecks() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.query('SELECT 1');
                console.log('[Pool] Health check passed');
            } catch (error: any) {
                console.error('[Pool] Health check failed:', error.message);
                this.handlePoolError(error);
            }
        }, this.config.healthCheckIntervalMs || 30000);
    }

    private startLeakDetection() {
        this.leakCheckInterval = setInterval(() => {
            const now = Date.now();

            for (const [ client, info ] of this.activeConnections.entries()) {
                const age = now - info.acquiredAt.getTime();

                // Warn if connection held too long
                if (age > 30000) {
                    console.warn(
                        `[Pool] Connection leak detected! Held for ${Math.round(age / 1000)}s\n` +
                        `Acquisition stack:\n${info.stack}`
                    );

                    // Emit event for monitoring
                    this.emit('connection-leak', {
                        age,
                        stack: info.stack,
                        queryCount: info.queryCount,
                    });
                }
            }
        }, 10000); // Check every 10s
    }

    /**
     * Get current pool metrics
     */
    getMetrics(): PoolMetrics {
        this.updateMetrics();
        return { ...this.metrics };
    }

    /**
     * Get circuit breaker state
     */
    getCircuitState(): 'closed' | 'open' | 'half-open' {
        return this.circuitState;
    }

    /**
     * Check if pool is healthy
     */
    isHealthy(): boolean {
        return (
            this.circuitState !== 'open' &&
            this.metrics.waitingClients < (this.config.max || 10) / 2 &&
            this.activeConnections.size < (this.config.max || 10)
        );
    }

    /**
     * Drain pool connections (for testing or shutdown)
     */
    async drain(): Promise<void> {
        console.log('[Pool] Draining connection pool...');

        // Wait for active connections to finish (with timeout)
        const timeout = 30000;
        const startTime = Date.now();

        while (this.activeConnections.size > 0 && Date.now() - startTime < timeout) {
            console.log(`[Pool] Waiting for ${this.activeConnections.size} active connections...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (this.activeConnections.size > 0) {
            console.warn(`[Pool] Forcing closure with ${this.activeConnections.size} active connections`);
        }
    }

    /**
     * Close pool and cleanup
     */
    async close(): Promise<void> {
        console.log('[Pool] Closing connection pool...');

        // Stop all intervals
        if (this.metricsInterval) clearInterval(this.metricsInterval);
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        if (this.leakCheckInterval) clearInterval(this.leakCheckInterval);
        if (this.circuitResetTimer) clearTimeout(this.circuitResetTimer);

        // Drain and close
        await this.drain();
        await this.pool.end();

        console.log('[Pool] Connection pool closed');
    }
}
