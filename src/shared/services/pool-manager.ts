import { Pool, PoolClient, PoolConfig } from 'pg';
import { EventEmitter } from 'events';
import { getPool, IS_DEBUG_MODE, IS_DEV, poolConfig } from '../db/index.js';



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

    constructor(config: PoolManagerConfig = {}) {
        super();

        this.pool = getPool();
        this.config = {
            // Circuit breaker 
            resetTimeoutMs: 60000,
            errorThreshold: IS_DEBUG_MODE ? 100 : 20,
            // Monitoring
            enableMetrics: true,
            metricsIntervalMs: 10000,
            // Health checks
            healthCheckIntervalMs: 30000,
            maxConnectionAge: 3600000, // 1 hour
            // Leak detection
            warnOnSlowQueries: true,
            slowQueryThresholdMs: IS_DEV ? 15000 : 5000,
            ...poolConfig, // access pool config
            ...config,
        };

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
            this.metrics.totalConnections++;
            console.debug({ totalConnections: this.metrics.totalConnections }, '[Pool] new connection',);
        });

        // Connection released back to pool
        this.pool.on('acquire', (client: PoolClient) => {
            console.debug({ totalConnections: this.metrics.totalConnections }, '[Pool] acquired connection');
        });

        // Connection removed from pool
        this.pool.on('remove', (client: PoolClient) => {
            this.metrics.totalConnections--;
            console.debug({ totalConnections: this.metrics.totalConnections }, `[Pool] connection removed`);
        });

        this.on('metrics', (m: typeof this.metrics) => {
            const usageRatio = m.totalConnections / (this.config.max || 10);

            // 1. Check if the pool is full
            if (usageRatio >= 0.9) {
                console.warn(`[Monitor] Pool near capacity: ${m.totalConnections} connections used.`);
            }

            // 2. Check if queries are queuing up
            if (m.waitingClients > 0) {
                console.warn(`[Monitor] Bottleneck detected: ${m.waitingClients} queries are waiting for a connection!`);
            }

            // 3. Track performance
            if (m.acquisitionTimeMs > 100) {
                console.warn(`[Monitor] Slow connection checkout: ${m.acquisitionTimeMs}ms`);
            }
        });

        // Error occurred
        this.pool.on('error', (err: Error, client: PoolClient) => {
            console.error({ error: err }, '[Pool] error');
            this.handlePoolError(err);
        });
    }

    private handlePoolError(err: Error) {

        const isSystemError = /timeout|connection|econnrefused/i.test(err.message);
        if (isSystemError) {
            this.metrics.errors++;
            this.metrics.lastError = err.message;
            this.metrics.lastErrorTime = new Date();
            this.errorCount++;

            if (this.errorCount >= 20) this.openCircuit();
        }
        this.emit('error', err);
    }

    private openCircuit() {

        if (this.circuitState === 'open') return;

        this.circuitState = 'open';
        this.emit('circuit-open');
        console.error({ circuitState: this.circuitState, errorCount: this.errorCount, totalConnections: this.metrics.totalConnections }, '[Pool] Breaker opened - too many errors');


        if (this.circuitResetTimer) {
            clearTimeout(this.circuitResetTimer);
        }

        this.circuitResetTimer = setTimeout(() => {
            this.circuitState = 'half-open';
            this.errorCount = 0;
            this.emit('circuit-half-open');
            console.debug({ circuitState: this.circuitState, errorCount: this.errorCount, totalConnections: this.metrics.totalConnections }, '[Pool] Breaker entered HALF-OPEN state');
        }, this.config.resetTimeoutMs || 60000);
    }

    private closeCircuit() {
        if (this.circuitState === 'closed') return;

        console.debug({ circuitState: this.circuitState, errorCount: this.errorCount, totalConnections: this.metrics.totalConnections }, '[Pool] Breaker closed - system recovered');
        this.circuitState = 'closed';
        this.errorCount = 0;
        this.emit('circuit-closed');
    }

    /**
     * Get connection with comprehensive error handling
     */
    async getConnection(): Promise<PoolClient> {

        if (this.circuitState === 'open' && !IS_DEBUG_MODE) {
            throw new Error('[Pool] Breaker OPEN - refusing conns');
        }

        const startTime = Date.now();
        try {
            const client = await this.pool.connect();

            const acquisitionTime = Date.now() - startTime;
            this.metrics.acquisitionTimeMs = acquisitionTime;

            if (acquisitionTime > 1000) {
                console.warn({ acquisitionTime, totalConnections: this.metrics.totalConnections }, "[Pool] Slow conn acquisition");
            }

            this.trackConnection(client);

            const originalRelease = client.release.bind(client);
            let released = false;
            client.release = (err?: Error | boolean) => {
                if (released) return;
                released = true;
                this.untrackConnection(client);
                return originalRelease(err);
            };

            if (this.circuitState === 'half-open') {
                this.closeCircuit();
            }

            return client;

        } catch (error: any) {
            console.error({ error }, '[Pool] Failed to acquire conn');
            this.handlePoolError(error);
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
                console.warn({ queryTimeMs: queryTime, query: text.slice(0, 100) }, `[Pool] Slow query detected`);
            }

            return result;
        } catch (error: any) {
            console.error({ error }, '[Pool] Failed to execute query');
            this.handlePoolError(error);
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
                console.debug('[Pool] HC');
            } catch (error: any) {
                console.error({ error }, '[Pool] Health check failed');
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
                        { age, stack: info.stack },
                        `[Pool] Conn leak detected`
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
        console.info('[Pool] Draining conn pool');

        // Wait for active connections to finish (with timeout)
        const timeout = 30000;
        const startTime = Date.now();

        while (this.activeConnections.size > 0 && Date.now() - startTime < timeout) {
            console.info({ activeConnections: this.activeConnections.size }, `[Pool] Waiting for active conns...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (this.activeConnections.size > 0) {
            console.warn(`[Pool] Forcing closure with active conns`);
        }
    }

    /**
     * Close pool and cleanup
     */
    async close(): Promise<void> {
        console.info('[Pool] Closing connection pool...');

        // 1. Stop all background monitoring tasks
        if (this.metricsInterval) clearInterval(this.metricsInterval);
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        if (this.leakCheckInterval) clearInterval(this.leakCheckInterval);
        if (this.circuitResetTimer) clearTimeout(this.circuitResetTimer);

        // 2. Remove listeners to prevent "Zombie Listeners" on the shared pool
        this.pool.removeAllListeners('connect');
        this.pool.removeAllListeners('acquire');
        this.pool.removeAllListeners('remove');
        this.pool.removeAllListeners('metrics');
        this.pool.removeAllListeners('error');

        // 3. Drain: Wait for active business queries (e.g. JobControlPlane updates) to finish
        await this.drain();

        // 4. Finally, terminate the actual TCP connections
        await this.pool.end();

        console.info('[Pool] Connections destroyed. Shutdown complete.');
    }
}
