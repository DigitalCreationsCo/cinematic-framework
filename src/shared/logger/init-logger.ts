import { logger } from './logger';
import { LogContext } from './log-context';
import { format } from 'util';
import os from 'os';
import { AsyncLocalStorage } from 'async_hooks';
import { extractErrorMessage } from '@shared/utils/errors';
import { Topic } from '@google-cloud/pubsub';



export { LogContext };
export const logContextStore = new AsyncLocalStorage<LogContext>();

export function initLogger(
    publishMessage?: Topic['publishMessage']
) {

    const publishPipelineEventInternal = async (event: any) => {
        if (publishMessage) {
            const dataBuffer = Buffer.from(JSON.stringify(event));
            await publishMessage({
                data: dataBuffer,
                attributes: { type: event.type }
            });
        }
    }

    const handleIntercept = async (level: 'info' | 'warn' | 'error', args: any[]) => {
        const context = logContextStore.getStore();

        const hasObject = typeof args[ 0 ] === 'object' && args[ 0 ] !== null;
        const metadata = hasObject ? args[ 0 ] : {};
        const messageArgs = hasObject ? args.slice(1) : args;
        const message = format(...messageArgs);

        const { shouldPublishLog, ...cleanContext } = context || {};

        logger[ level ]({ ...cleanContext, ...metadata }, message);

        if (shouldPublishLog === true && context && context.projectId && publishPipelineEventInternal) {

            let refinedMessage = message;

            if (level === 'error' || metadata.error || metadata.err) {
                const errorObj = metadata.error || metadata.err || args.find(a => a instanceof Error);
                if (errorObj) {
                    refinedMessage = extractErrorMessage(errorObj);
                } else {
                    refinedMessage = message.split('Execution failed:').pop()?.trim() || message;
                }
            }

            publishPipelineEventInternal({
                type: "LOG",
                projectId: context.projectId,
                correlationId: context.correlationId,
                payload: {
                    level,
                    message: refinedMessage,
                    job_id: context.jobId,
                },
            }).catch(err => {
                logger.error({ err }, "Failed to publish log to pipeline");
            });
        }
    };

    console.log = (...args) => handleIntercept('info', args);
    console.warn = (...args) => handleIntercept('warn', args);
    console.error = (...args) => handleIntercept('error', args);
}