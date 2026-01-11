// src/pipeline/index.ts
import { PubSub } from "@google-cloud/pubsub";
import { PipelineCommand, PipelineEvent } from "../shared/types/pubsub.types";
import {
    JOB_EVENTS_TOPIC_NAME,
    PIPELINE_EVENTS_TOPIC_NAME,
    PIPELINE_COMMANDS_TOPIC_NAME,
    PIPELINE_CANCELLATIONS_TOPIC_NAME,
    PIPELINE_JOB_EVENTS_SUBSCRIPTION,
    PIPELINE_COMMANDS_SUBSCRIPTION,
    WORKER_JOB_EVENTS_SUBSCRIPTION
} from "../shared/constants";
import { JobEvent } from "../shared/types/job-types";
import { ApiError as StorageApiError } from "@google-cloud/storage";
import { CheckpointerManager } from "../workflow/checkpointer-manager";
import { AsyncLocalStorage } from "async_hooks";
import { handleStartPipelineCommand } from './handlers/handleStartPipelineCommand';
import { handleRequestFullStateCommand } from './handlers/handleRequestFullStateCommand';
import { handleResumePipelineCommand } from './handlers/handleResumePipelineCommand';
import { handleRegenerateSceneCommand } from './handlers/handleRegenerateSceneCommand';
import { handleRegenerateFrameCommand } from './handlers/handleRegenerateFrameCommand';
import { handleUpdateSceneAssetCommand } from './handlers/handleUpdateSceneAssetCommand';
import { handleResolveInterventionCommand } from './handlers/handleResolveInterventionCommand';
import { handleStopPipelineCommand } from './handlers/handleStopPipelineCommand';
import { formatLoggers } from "./helpers/format-loggers";
import { WorkflowOperator } from "./services/workflow-service";
import { DistributedLockManager } from "./services/lock-manager";
import { v4 as uuidv4 } from 'uuid';
import { PoolManager } from "./services/pool-manager";
import { JobControlPlane } from "./services/job-control-plane";
import { ProjectRepository } from "./project-repository";
import { handleJobCompletion } from "./handlers/handleJobCompletion";

const projectIdStore = new AsyncLocalStorage<string>();

const gcpProjectId = process.env.GCP_PROJECT_ID;
if (!gcpProjectId) throw Error("A GCP projectId was not provided");

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) throw Error("Postgres URL is required for CheckpointerManager initialization");

const workerId = uuidv4();

const checkpointerManager = new CheckpointerManager(postgresUrl);
await checkpointerManager.init();

const poolManager = new PoolManager({
    connectionString: postgresUrl,
    max: 20,
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    enableMetrics: true,
    metricsIntervalMs: 30000,
});

const lockManager = new DistributedLockManager(poolManager, workerId);
await lockManager.init();


const PIPELINE_CANCELLATIONS_SUBSCRIPTION_NAME = `worker-${workerId}-cancellations`;

const pubsub = new PubSub({
    projectId: gcpProjectId,
    apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
});

const jobEventsTopicPublisher = pubsub.topic(JOB_EVENTS_TOPIC_NAME);
const videoEventsTopicPublisher = pubsub.topic(PIPELINE_EVENTS_TOPIC_NAME);

export async function publishJobEvent(event: JobEvent) {
    console.log(`[Pipeline] Publishing job event ${event.type} to ${JOB_EVENTS_TOPIC_NAME}`);
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await jobEventsTopicPublisher.publishMessage({ data: dataBuffer });
}
export async function publishPipelineEvent(event: PipelineEvent) {
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await videoEventsTopicPublisher.publishMessage({ data: dataBuffer });
}

async function main() {
    console.log(`Starting pipeline service ${workerId}...`);

    try {
        formatLoggers(projectIdStore, publishPipelineEvent);
        checkpointerManager.getCheckpointer();

        const jobControlPlane = new JobControlPlane(poolManager, publishJobEvent);
        await jobControlPlane.init();

        const projectRepository = new ProjectRepository();
        const workflowOperator = new WorkflowOperator(checkpointerManager, jobControlPlane, publishPipelineEvent, projectRepository);


        // create job events topic, ensure pipeline event subscription exists
        console.log(`[Pipeline ${workerId}] Ensuring topic ${JOB_EVENTS_TOPIC_NAME} exists...`);
        const [ jobEventsTopic ] = await pubsub.topic(JOB_EVENTS_TOPIC_NAME).get({ autoCreate: true });

        console.log(`[Pipeline ${workerId}] Ensuring subscription ${PIPELINE_JOB_EVENTS_SUBSCRIPTION} exists on ${JOB_EVENTS_TOPIC_NAME}...`);
        await jobEventsTopic.subscription(PIPELINE_JOB_EVENTS_SUBSCRIPTION).get({ autoCreate: true });

        console.log(`[Pipeline ${workerId}] Ensuring subscription ${WORKER_JOB_EVENTS_SUBSCRIPTION} exists on ${JOB_EVENTS_TOPIC_NAME}...`);
        await jobEventsTopic.subscription(WORKER_JOB_EVENTS_SUBSCRIPTION).get({ autoCreate: true });

        // subscribe to worker job events
        const workerEventsSubscription = pubsub.subscription(PIPELINE_JOB_EVENTS_SUBSCRIPTION);
        console.log(`[Pipeline ${workerId}] Listening for job events on ${PIPELINE_JOB_EVENTS_SUBSCRIPTION}`);

        // subscribe to server forwarded commands;
        const [ videoCommandsTopic ] = await pubsub.topic(PIPELINE_COMMANDS_TOPIC_NAME).get({ autoCreate: true });
        await pubsub.topic(PIPELINE_EVENTS_TOPIC_NAME).get({ autoCreate: true });
        await videoCommandsTopic.subscription(PIPELINE_COMMANDS_SUBSCRIPTION).get({ autoCreate: true });
        console.log(`[Pipeline ${workerId} Listening for pipeline commands on ${PIPELINE_COMMANDS_SUBSCRIPTION}`);

        // distributed signal for pipeline cancellations
        const [ videoCancellationsTopic ] = await pubsub.topic(PIPELINE_CANCELLATIONS_TOPIC_NAME).get({ autoCreate: true });
        await videoCancellationsTopic.createSubscription(PIPELINE_CANCELLATIONS_SUBSCRIPTION_NAME);
        const cancellationSubscription = pubsub.subscription(PIPELINE_CANCELLATIONS_SUBSCRIPTION_NAME);
        console.log(`[Pipeline ${workerId}] Listening for cancellations on ${PIPELINE_CANCELLATIONS_SUBSCRIPTION_NAME}`);

        const pipelineCommandsSubscription = pubsub.subscription(PIPELINE_COMMANDS_SUBSCRIPTION);
        console.log(`Listening for commands on ${PIPELINE_COMMANDS_SUBSCRIPTION}...`);


    workerEventsSubscription.on("message", async (message) => {
        let event: JobEvent | undefined;

        try {
            event = JSON.parse(message.data.toString());
        } catch (error) {
            console.error("[Job Listener]: Error parsing message:", error);
            message.ack();
            return;
        }

        if (event && 'type' in event && event.type.startsWith('JOB_')) {
            const { jobId } = event;
            if (event.type === 'JOB_COMPLETED') {
                await handleJobCompletion(jobId, workflowOperator, jobControlPlane);
            }

            if (event.type === 'JOB_FAILED') {
                try {
                    const job = await jobControlPlane.getJob(jobId);
                    if (!job || job.state !== "FAILED") {
                        console.warn(`[Pipeline] Job ${jobId} not found or not completed`);
                        return;
                    }

                    const projectId = job.projectId;
                    await publishPipelineEvent({
                        type: "WORKFLOW_FAILED",
                        projectId: projectId,
                        payload: { error: job.error || `Job ${jobId} (${job.type}) failed` },
                        timestamp: new Date().toISOString(),
                    });
                    console.warn(`[Pipeline] Job ${jobId} (${job.type}) failed.`);
                    return;
                } catch (err) {
                    console.error("[Pipeline] Error handling job failure:", err);
                }
            }
        }
        message.ack();
    });


    cancellationSubscription.on("message", async (message) => {
        try {
            const payload = JSON.parse(message.data.toString());
            if (payload.projectId) {
                await workflowOperator.stopPipeline(payload.projectId);
            }
        } catch (err) {
            console.error("Error processing cancellation message:", err);
        }
        message.ack();
    });

    const publishCancellation = async (projectId: string) => {
        const dataBuffer = Buffer.from(JSON.stringify({ projectId }));
        await videoCancellationsTopic.publishMessage({ data: dataBuffer });
    };

    pipelineCommandsSubscription.on("message", async (message) => {
        let command: PipelineCommand | undefined;

        try {
            command = JSON.parse(message.data.toString()) as PipelineCommand;
        } catch (error) {
            console.error("[Pipeline Command]: Error parsing command:", error);
            message.ack();
            return;
        }

        console.log(`[Pipeline Command] Received command: ${command.type} for projectId: ${command.projectId} (Msg ID: ${message.id}, Attempt: ${message.deliveryAttempt})`);

        message.ack();

        try {
            await projectIdStore.run(command.projectId, async () => {
                switch (command.type) {
                    case "START_PIPELINE":
                        await handleStartPipelineCommand(command, workflowOperator);
                        break;
                    case "REQUEST_FULL_STATE":
                        await handleRequestFullStateCommand(command, workflowOperator);
                        break;
                    case "RESUME_PIPELINE":
                        await handleResumePipelineCommand(command, workflowOperator);
                        break;
                    case "REGENERATE_SCENE":
                        await handleRegenerateSceneCommand(command, workflowOperator);
                        break;
                    case "REGENERATE_FRAME":
                        await handleRegenerateFrameCommand(command, workflowOperator);
                        break;
                    case "UPDATE_SCENE_ASSET":
                        await handleUpdateSceneAssetCommand(command, workflowOperator);
                        break;
                    case "RESOLVE_INTERVENTION":
                        await handleResolveInterventionCommand(command, workflowOperator);
                        break;
                    case "STOP_PIPELINE":
                        await handleStopPipelineCommand(command, publishCancellation);
                        break;
                }
            });
        } catch (error) {
            console.error(`[Pipeline Command] Error processing command for project ${command.projectId}:`, error);
            if (error instanceof StorageApiError) {
                pipelineCommandsSubscription.close();
                process.exit(1);
            }
        }
    });

    process.on("SIGINT", async () => {
        console.log("Shutting down worker...");
        workerEventsSubscription.close();
        cancellationSubscription.close();
        pipelineCommandsSubscription.close();
        try {
            console.log("Deleting ephemeral subscription...");
            await workerEventsSubscription.delete();
            await cancellationSubscription.delete();
            await pipelineCommandsSubscription.delete();
            console.log("Deleted ephemeral cancellation subscription");
        } catch (e) {
            console.error("Failed to delete subscription (it might have been deleted already or connection failed)", e);
        }
        process.exit(0);
    });

    if ((import.meta as any).hot) {
        (import.meta as any).hot.dispose(() => {
            console.log("Closing pipeline subscription for HMR...");
            workerEventsSubscription.close();
            cancellationSubscription.close();
            pipelineCommandsSubscription.close();
        });
    }
    } catch (error) {
        console.error(`[Pipeline ${workerId}] FATAL: PubSub initialization failed:`, error);
        console.error(`[Pipeline ${workerId}] Service cannot start without PubSub. Shutting down...`);
        process.exit(1);
    }
}

main().catch(console.error);
