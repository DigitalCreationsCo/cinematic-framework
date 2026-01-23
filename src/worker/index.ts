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
import { DistributedLockManager } from "../pipeline/services/lock-manager";
import * as dotenv from "dotenv";
import { initLogger, LogContext } from "../shared/logger/init-logger";
import { ensureSubscription, ensureTopic } from "@shared/utils/pubsub-utils";
import { getPool, initializeDatabase } from "@shared/db";
dotenv.config();



const gcpProjectId = process.env.GCP_PROJECT_ID;
if (!gcpProjectId) throw Error("A GCP projectId was not provided");

const bucketName = process.env.GCP_BUCKET_NAME;
if (!bucketName) throw Error("A bucket name was not provided");

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) throw Error("Postgres URL is required");



initializeDatabase(getPool());

const logContextStore = new AsyncLocalStorage<LogContext>();

const workerId = uuidv7();

const poolManager = new PoolManager();

const lockManager = new DistributedLockManager(poolManager, workerId);
await lockManager.init();

const pubsub = new PubSub({
    projectId: gcpProjectId,
    ...(process.env.PUBSUB_EMULATOR_HOST ? { apiEndpoint: process.env.PUBSUB_EMULATOR_HOST } : {}),
});

const jobEventsTopicPublisher = pubsub.topic(JOB_EVENTS_TOPIC_NAME);
const videoEventsTopicPublisher = pubsub.topic(PIPELINE_EVENTS_TOPIC_NAME);

async function publishJobEvent(event: JobEvent) {
    console.log({ event }, `Publishing job event to ${JOB_EVENTS_TOPIC_NAME}`);
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await jobEventsTopicPublisher.publishMessage({
        data: dataBuffer,
        attributes: { type: event.type }
    });
}

export async function publishPipelineEvent(event: PipelineEvent) {
    console.log({ event }, `Publishing pipeline event to ${PIPELINE_EVENTS_TOPIC_NAME}`);
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await videoEventsTopicPublisher.publishMessage({
        data: dataBuffer,
        attributes: { type: event.type }
    });
}

const jobControlPlane = new JobControlPlane(poolManager, publishJobEvent);

const workerService = new WorkerService(gcpProjectId, workerId, bucketName, jobControlPlane, lockManager, publishJobEvent, publishPipelineEvent);

const logContext: LogContext = {
    w_id: workerId,
    correlationId: uuidv7(),
    shouldPublishLog: false,
};

async function main() {
    console.log(`Starting generative worker service ${workerId}...`);
    initLogger(
        publishPipelineEvent
    );
    await logContextStore.run(logContext, async () => {
        try {
            // 1. Initialize Infrastructure
            const jobEventsTopic = await ensureTopic(pubsub, JOB_EVENTS_TOPIC_NAME);

            await ensureSubscription(jobEventsTopic, WORKER_JOB_EVENTS_SUBSCRIPTION, {
                filter: 'attributes.type = "JOB_DISPATCHED"'
            });

            // 2. Setup Consumer
            const subscription = pubsub.subscription(WORKER_JOB_EVENTS_SUBSCRIPTION);
            console.log(`Listening on ${WORKER_JOB_EVENTS_SUBSCRIPTION}`);

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
                            console.log({ event }, `Received JOB_DISPATCHED event.`);
                            await workerService.processJob(event.jobId);
                        });
                    }
                    await message.ackWithResponse(); 
                } catch (error) {
                    console.error({ error }, `Error processing message`);
                    message.nack();
                }
            });

            // Handle shutdown
            const handleShutdown = async () => {
                console.log("Shutting down worker service...");
                subscription.close();
                await lockManager.close();
                await poolManager.close();
                console.log("Shut down successful.");
                process.exit(0);
            };

            process.on("SIGINT", handleShutdown);
            process.on("SIGTERM", handleShutdown);

        } catch (error) {
            console.error({ error }, `FATAL: PubSub initialization failed.`);
            process.exit(1);
        }
    });
}

main().catch(console.error);