// src/worker/index.ts
import { PubSub } from "@google-cloud/pubsub";
import { PipelineEvent } from "../shared/types/pubsub.types";
import {
    JOB_EVENTS_TOPIC_NAME,
    PIPELINE_EVENTS_TOPIC_NAME,
    WORKER_JOB_EVENTS_SUBSCRIPTION,
    PIPELINE_JOB_EVENTS_SUBSCRIPTION
} from "../shared/constants";
import { JobEvent } from "../shared/types/job-types";
import { PoolManager } from "../pipeline/services/pool-manager";
import { JobControlPlane } from "../pipeline/services/job-control-plane";
import { v7 as uuidv7 } from 'uuid';
import * as dotenv from "dotenv";
import { WorkerService } from "./worker-service";

dotenv.config();

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
    idleTimeoutMillis: 30000,
});

const pubsub = new PubSub({
    projectId: gcpProjectId,
    apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
});

const jobEventsTopicPublisher = pubsub.topic(JOB_EVENTS_TOPIC_NAME);
const videoEventsTopicPublisher = pubsub.topic(PIPELINE_EVENTS_TOPIC_NAME);

async function publishJobEvent(event: JobEvent) {
    console.log(`[Worker] Publishing job event ${event.type} to ${JOB_EVENTS_TOPIC_NAME}`);
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await jobEventsTopicPublisher.publishMessage({ data: dataBuffer });
}

export async function publishPipelineEvent(event: PipelineEvent) {
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await videoEventsTopicPublisher.publishMessage({ data: dataBuffer });
}

const jobControlPlane = new JobControlPlane(poolManager, publishJobEvent);

const workerService = new WorkerService(workerId, bucketName, jobControlPlane, publishJobEvent, publishPipelineEvent);

async function main() {
    console.log(`Starting generative worker service ${workerId}...`);

    try {
        await jobControlPlane.init();

        const [ topic ] = await pubsub.topic(JOB_EVENTS_TOPIC_NAME).get({ autoCreate: true });

        console.log(`[Worker ${workerId}] Ensuring subscription ${WORKER_JOB_EVENTS_SUBSCRIPTION} exists on ${JOB_EVENTS_TOPIC_NAME}...`);
        await topic.subscription(WORKER_JOB_EVENTS_SUBSCRIPTION).get({ autoCreate: true });

        console.log(`[Worker ${workerId}] Ensuring subscription ${PIPELINE_JOB_EVENTS_SUBSCRIPTION} exists on ${JOB_EVENTS_TOPIC_NAME}...`);
        await topic.subscription(PIPELINE_JOB_EVENTS_SUBSCRIPTION).get({ autoCreate: true });

        const subscription = pubsub.subscription(WORKER_JOB_EVENTS_SUBSCRIPTION);
        console.log(`[Worker ${workerId}] Listening on ${WORKER_JOB_EVENTS_SUBSCRIPTION}`);

        subscription.on("message", async (message) => {
            try {
                const event = JSON.parse(message.data.toString()) as JobEvent;

                message.ack();
                if (event.type === "JOB_DISPATCHED") {
                    console.log(`[Worker ${workerId}] Received JOB_DISPATCHED for ${event.jobId}`);
                    workerService.processJob(event.jobId);
                }
            } catch (error) {
                console.error(`[Worker ${workerId}] Error parsing message:`, error);
                message.nack();
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
}

main().catch(console.error);