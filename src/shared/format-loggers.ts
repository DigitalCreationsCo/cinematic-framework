import { logger, LogContext } from './logger';
import { format } from 'util';
import os from 'os';
import { AsyncLocalStorage } from 'async_hooks';



export { LogContext };
export const logContextStore = new AsyncLocalStorage<LogContext>();

// Helper to determine if a log is marked as internal-only
const isInternalLog = (args: any[]) =>
    args.some(arg => typeof arg === 'string' && arg.includes("LOG_INTERNAL_ONLY"));

export function formatLoggers(
    store: { getStore: () => LogContext | undefined; },
    publishPipelineEvent?: (event: any) => Promise<void>
) {
    const handleIntercept = async (level: string, args: any[]) => {
        const context = store.getStore();

        // 1. Format the human-readable message string (handles %s, %d, etc.)
        const message = format(...args);

        // 2. Extract any objects from args to merge into the JSON structure
        //    (This allows console.log("Event", { userId: 1 }) to structure 'userId')
        const objectArgs = args.find(arg => typeof arg === 'object' && arg !== null) || {};

        // 3. Log locally using Pino (Structured)
        //    We merge context first, then object args, then the readable message
        (logger as any)[ level ]({ ...context, ...objectArgs }, message);

        // 4. Determine if we should publish to the Pipeline
        //    DEFAULT: Publish UNLESS explicitly disabled in context OR marked internal
        const shouldPublishLog =
            context &&
            context.projectId &&
            (context.shouldPublishLog !== false || !isInternalLog(args)) &&
            publishPipelineEvent;

        if (shouldPublishLog) {
            publishPipelineEvent({
                type: "LOG",
                projectId: context.projectId,
                correlationId: context.correlationId,
                timestamp: new Date().toISOString(),
                payload: {
                    level,
                    message, // The clean, formatted string
                    job_id: context.jobId,
                    worker_id: context.workerId,
                    server_id: context.serverId,
                    hostname: os.hostname(),
                    process_id: process.pid,
                    // If you really want raw args dump, put it in a specific field
                    // raw_args: args 
                },
            }).catch(err => {
                // Use a string flag to prevent infinite recursion
                logger.error({ err, internal: true }, "LOG_INTERNAL_ONLY: Failed to publish pipeline event");
            });
        }
    };

    // Monkey-patch console methods
    console.log = (...args) => handleIntercept('info', args);
    console.warn = (...args) => handleIntercept('warn', args);
    console.error = (...args) => handleIntercept('error', args);
}