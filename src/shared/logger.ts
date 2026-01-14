import pino from 'pino';
import os from 'os';



export interface LogContext {
    commandId?: string;
    jobId?: string;
    projectId?: string;
    workerId: string;
    correlationId: string;
    shouldPublishLog: boolean;
    [ key: string ]: any;
}

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    // Mix in global worker context to every log
    mixin() {
        return { worker_id: `${os.hostname()}-${process.pid}`.toLowerCase() };
    },
    formatters: {
        level: (label) => ({ level: label.toUpperCase() }),
    },
    // Add human-readable timestamps for machine logs too
    base: undefined, // Removes pid/hostname from default to use our mixin format
    timestamp: () => `,"timestamp_iso":"${new Date().toISOString()}","timestamp_human":"${new Date().toLocaleString()}"`,
    transport: isDev ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' }
    } : undefined,
});

/**
 * Creates a scoped logger for a specific job or project.
 * This ensures every log line within a job execution automatically 
 * includes the IDs without re-typing them.
 */
export function createJobLogger(context: LogContext) {
    return logger.child(context);
}