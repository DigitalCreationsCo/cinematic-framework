// src/worker/index.ts
import { PubSub } from "@google-cloud/pubsub";
import { PipelineEvent } from "../shared/types/pipeline.types";
import {
    JOB_EVENTS_TOPIC_NAME,
    PIPELINE_EVENTS_TOPIC_NAME,
    WORKER_JOB_EVENTS_SUBSCRIPTION,
    PIPELINE_JOB_EVENTS_SUBSCRIPTION
} from "../shared/constants";
import { JobEvent } from "../shared/types/job.types";
import { PoolManager } from "../pipeline/services/pool-manager";
import { JobControlPlane } from "../pipeline/services/job-control-plane";
import { AsyncLocalStorage } from "async_hooks";
import { v7 as uuidv7 } from 'uuid';
import { WorkerService } from "./worker-service";
import { LogContext } from "../shared/logger";
import * as dotenv from "dotenv";
import { formatLoggers } from "../shared/format-loggers";
dotenv.config();

const logContextStore = new AsyncLocalStorage<LogContext>();

const workerId = uuidv7();

const gcpProjectId = process.env.GCP_PROJECT_ID;
if (!gcpProjectId) throw Error("A GCP projectId was not provided");

const bucketName = process.env.GCP_BUCKET_NAME;
if (!bucketName) throw Error("A bucket name was not provided");

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) throw Error("Postgres URL is required");

const poolManager = new PoolManager({
    connectionString: postgresUrl,
    max: 10,
    min: 2,
});

const pubsub = new PubSub({
    projectId: gcpProjectId,
    ...(process.env.PUBSUB_EMULATOR_HOST ? { apiEndpoint: process.env.PUBSUB_EMULATOR_HOST } : {}),
});

const jobEventsTopicPublisher = pubsub.topic(JOB_EVENTS_TOPIC_NAME);
const videoEventsTopicPublisher = pubsub.topic(PIPELINE_EVENTS_TOPIC_NAME);

async function publishJobEvent(event: JobEvent) {
    console.log(`[Worker] Publishing job event ${event.type} to ${JOB_EVENTS_TOPIC_NAME}`);
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await jobEventsTopicPublisher.publishMessage({
        data: dataBuffer,
        attributes: { type: event.type }
    });
}

export async function publishPipelineEvent(event: PipelineEvent) {
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await videoEventsTopicPublisher.publishMessage({
        data: dataBuffer,
        attributes: { type: event.type }
    });
}

const jobControlPlane = new JobControlPlane(poolManager, publishJobEvent);

const workerService = new WorkerService(gcpProjectId, workerId, bucketName, jobControlPlane, publishJobEvent, publishPipelineEvent);

const logContext: LogContext = {
    workerId,
    correlationId: uuidv7(),
    shouldPublishLog: false,
};

async function main() {
    console.log(`Starting generative worker service ${workerId}...`);
    formatLoggers(
        { getStore: logContextStore.getStore.bind(logContextStore) },
        publishPipelineEvent
    );
    await logContextStore.run(logContext, async () => {
        try {

            const [ topic ] = await pubsub.topic(JOB_EVENTS_TOPIC_NAME).get({ autoCreate: true });
            const ensureSubscription = async (topic: any, subscriptionName: string, filter?: string) => {
                console.log(`[Worker ${workerId}] Ensuring subscription ${subscriptionName} exists on ${topic.name}...`);
                const isDev = process.env.NODE_ENV !== 'production';
                try {
                    await topic.createSubscription(subscriptionName, {
                        enableExactlyOnceDelivery: true,
                        ackDeadlineSeconds: 60, // Increased to 60s for stability
                        expirationPolicy: { ttl: { seconds: 24 * 60 * 60 } }, 
                        filter
                    });
                } catch (e: any) {
                    if (e.code !== 6) throw e;
                }
            };
            await ensureSubscription(topic, WORKER_JOB_EVENTS_SUBSCRIPTION, 'attributes.type = "JOB_DISPATCHED"');

            const subscription = pubsub.subscription(WORKER_JOB_EVENTS_SUBSCRIPTION);
            console.log(`[Worker ${workerId}] Listening on ${WORKER_JOB_EVENTS_SUBSCRIPTION}`);

            subscription.on("message", async (message) => {
                try {
                    let event: JobEvent | undefined;
                    try {
                        event = JSON.parse(message.data.toString());
                    } catch (error) {
                        console.error("[Job Listener]: Error parsing message:", error);
                        message.ack();
                        return;
                    }

                    if (event && event.type === "JOB_DISPATCHED") {
                        await logContextStore.run({ ...logContext, jobId: event.jobId, shouldPublishLog: false }, async () => {

                            console.log(`[Worker ${workerId}] Received JOB_DISPATCHED for ${event.jobId}`);
                            await workerService.processJob(event.jobId);
                        });
                    }
                    await message.ackWithResponse(); // Using ackWithResponse for exactly-once
                } catch (error) {
                    console.error(`[Worker ${workerId}] Error processing message:`, error);
                }
            });

            // Handle shutdown
            process.on("SIGINT", async () => {
                console.log("Shutting down worker...");
                subscription.close();
                await poolManager.close();
                process.exit(0);
            });
        } catch (error) {
            console.error(`[Worker ${workerId}] FATAL: PubSub initialization failed:`, error);
            console.error(`[Worker ${workerId}] Service cannot start without PubSub. Shutting down...`);
            process.exit(1);
        }
    });
}

main().catch(console.error);