// src/pipeline/index.ts
import { PubSub, Topic } from "@google-cloud/pubsub";
import { PipelineCommand, PipelineEvent } from "../shared/types/pipeline.types";
import {
    JOB_EVENTS_TOPIC_NAME,
    PIPELINE_EVENTS_TOPIC_NAME,
    PIPELINE_COMMANDS_TOPIC_NAME,
    PIPELINE_CANCELLATIONS_TOPIC_NAME,
    PIPELINE_JOB_EVENTS_SUBSCRIPTION,
    PIPELINE_COMMANDS_SUBSCRIPTION,
    WORKER_JOB_EVENTS_SUBSCRIPTION
} from "../shared/constants";
import { JobEvent } from "../shared/types/job.types";
import { ApiError as StorageApiError } from "@google-cloud/storage";
import { CheckpointerManager } from "../workflow/checkpointer-manager";
import { handleStartPipelineCommand } from './handlers/handleStartPipelineCommand';
import { handleRequestFullStateCommand } from './handlers/handleRequestFullStateCommand';
import { handleResumePipelineCommand } from './handlers/handleResumePipelineCommand';
import { handleRegenerateSceneCommand } from './handlers/handleRegenerateSceneCommand';
import { handleRegenerateFrameCommand } from './handlers/handleRegenerateFrameCommand';
import { handleUpdateSceneAssetCommand } from './handlers/handleUpdateSceneAssetCommand';
import { handleResolveInterventionCommand } from './handlers/handleResolveInterventionCommand';
import { handleStopPipelineCommand } from './handlers/handleStopPipelineCommand';
import { formatLoggers, logContextStore, LogContext } from "../shared/format-loggers";
import { WorkflowOperator } from "./services/workflow-service";
import { DistributedLockManager } from "./services/lock-manager";
import { v7 as uuidv7 } from 'uuid';
import { PoolManager } from "./services/pool-manager";
import { JobControlPlane } from "./services/job-control-plane";
import { ProjectRepository } from "./project-repository";
import { handleJobCompletion } from "./handlers/handleJobCompletion";
import { JobLifecycleMonitor } from "./services/job-lifecycle-monitor";



const gcpProjectId = process.env.GCP_PROJECT_ID;
if (!gcpProjectId) throw Error("A GCP projectId was not provided");

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) throw Error("Postgres URL is required for CheckpointerManager initialization");

const workerId = uuidv7();

const checkpointerManager = new CheckpointerManager(postgresUrl);
await checkpointerManager.init();

const poolManager = new PoolManager({
    connectionString: postgresUrl,
    max: 20,
    min: 5,
    enableMetrics: true,
    metricsIntervalMs: 30000,
});

const lockManager = new DistributedLockManager(poolManager, workerId);
await lockManager.init();


const pubsub = new PubSub({
    projectId: gcpProjectId,
    ...(process.env.PUBSUB_EMULATOR_HOST ? { apiEndpoint: process.env.PUBSUB_EMULATOR_HOST } : {}),
});

const PIPELINE_CANCELLATIONS_SUBSCRIPTION_NAME = `worker-${workerId}-cancellations`;
const jobEventsTopicPublisher = pubsub.topic(JOB_EVENTS_TOPIC_NAME);
const videoEventsTopicPublisher = pubsub.topic(PIPELINE_EVENTS_TOPIC_NAME);

export async function publishJobEvent(event: JobEvent) {
    console.log(`[Pipeline] Publishing job event ${event.type} to ${JOB_EVENTS_TOPIC_NAME}`);
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

const logContext: LogContext = {
    workerId,
    correlationId: uuidv7(),
    shouldPublishLog: false,
};

const isDev = process.env.NODE_ENV !== 'production';


async function main() {

    formatLoggers(
        { getStore: logContextStore.getStore.bind(logContextStore) },
        publishPipelineEvent
    );
    console.log(`Starting pipeline service ${workerId}...`);
    await logContextStore.run(logContext, async () => {

        try {
        const jobControlPlane = new JobControlPlane(poolManager, publishJobEvent);
        const jobLifecycleMonitor = JobLifecycleMonitor.getInstance(jobControlPlane);
        jobLifecycleMonitor.start();

            checkpointerManager.getCheckpointer();
        const projectRepository = new ProjectRepository();
        const workflowOperator = new WorkflowOperator(checkpointerManager, jobControlPlane, publishPipelineEvent, projectRepository);

        const [ jobEventsTopic ] = await pubsub.topic(JOB_EVENTS_TOPIC_NAME).get({ autoCreate: true });
            console.log(`[Pipeline ${workerId}] Ensuring topic ${JOB_EVENTS_TOPIC_NAME} exists...`);

        const ensureSubscription = async (topic: Topic, subscriptionName: string, filter?: string) => {
            console.log(`[Pipeline ${workerId}] Ensuring subscription ${subscriptionName} exists on ${topic.name}...`);

            try {
                await topic.createSubscription(subscriptionName, {
                    enableExactlyOnceDelivery: true,
                    ackDeadlineSeconds: 60,
                    expirationPolicy: { ttl: { seconds: 24 * 60 * 60 } },
                    filter
                });
            } catch (e: any) {
                if (e.code !== 6) throw e;
            }
        };

            await ensureSubscription(jobEventsTopic, PIPELINE_JOB_EVENTS_SUBSCRIPTION, 'attributes.type = "JOB_COMPLETED" OR attributes.type = "JOB_FAILED"');
        await ensureSubscription(jobEventsTopic, WORKER_JOB_EVENTS_SUBSCRIPTION, 'attributes.type = "JOB_DISPATCHED"');

        const workerEventsSubscription = pubsub.subscription(PIPELINE_JOB_EVENTS_SUBSCRIPTION);
        console.log(`[Pipeline ${workerId}] Listening for job events on ${PIPELINE_JOB_EVENTS_SUBSCRIPTION}`);

        const [ videoCommandsTopic ] = await pubsub.topic(PIPELINE_COMMANDS_TOPIC_NAME).get({ autoCreate: true });
        await pubsub.topic(PIPELINE_EVENTS_TOPIC_NAME).get({ autoCreate: true });
        await ensureSubscription(videoCommandsTopic, PIPELINE_COMMANDS_SUBSCRIPTION);
        console.log(`[Pipeline ${workerId} Listening for pipeline commands on ${PIPELINE_COMMANDS_SUBSCRIPTION}`);

            const [ videoCancellationsTopic ] = await pubsub.topic(PIPELINE_CANCELLATIONS_TOPIC_NAME).get({ autoCreate: true });
        try {
            await videoCancellationsTopic.createSubscription(PIPELINE_CANCELLATIONS_SUBSCRIPTION_NAME, {
                enableExactlyOnceDelivery: true,
                ackDeadlineSeconds: 30,
                expirationPolicy: { ttl: { seconds: 12 * 60 * 60 } }, // 12h expiration for cancellations
            });
        } catch (e: any) {
            if (e.code !== 6) throw e;
        }
        const cancellationSubscription = pubsub.subscription(PIPELINE_CANCELLATIONS_SUBSCRIPTION_NAME);
        console.log(`[Pipeline ${workerId}] Listening for cancellations on ${PIPELINE_CANCELLATIONS_SUBSCRIPTION_NAME}`);

        const pipelineCommandsSubscription = pubsub.subscription(PIPELINE_COMMANDS_SUBSCRIPTION);
        console.log(`Listening for commands on ${PIPELINE_COMMANDS_SUBSCRIPTION}...`);


            workerEventsSubscription.on("message", async (message) => {

                console.log(`[Pipeline ${workerId}] Received job event: ${message.data.toString()}`);
                let event: JobEvent | undefined;
                try {
                    event = JSON.parse(message.data.toString());
                } catch (error) {
                    console.error("[Job Listener]: Error parsing message:", error);
                    await message.ackWithResponse();
                    return;
                }

                if (event && 'type' in event && event.type.startsWith('JOB_')) {
                    await logContextStore.run({ ...logContext, jobId: event.jobId, shouldPublishLog: true }, async () => {

                        const { jobId } = event;
                        if (event.type === 'JOB_COMPLETED') {
                            await handleJobCompletion(jobId, workflowOperator, jobControlPlane);
                        }

                        if (event.type === 'JOB_FAILED') {
                            try {
                                const job = await jobControlPlane.getJob(jobId);
                                if (!job || job.state !== "FAILED") {
                                    console.warn(`[Pipeline.jobFailed] Job ${jobId} not found or not completed`);
                                    return;
                                }

                            const { maxRetries } = job;
                            const nextAttempt = job.attempt + 1;
                            const isPermanentlyFailed = nextAttempt > maxRetries;

                            await jobControlPlane.updateJobSafe(jobId, job.attempt, {
                                state: isPermanentlyFailed ? "FATAL" : "FAILED",
                                error: job.error,
                                attempt: nextAttempt,
                                updatedAt: new Date()
                            });

                            console.warn(`[Job ${jobId}] ${isPermanentlyFailed ? 'Max retries reached' : 'Marked for retry'}`); return;
                        } catch (err) {
                            console.error("[Pipeline] Error handling job failure:", err);
                        }
                    }

                    });
                }
                await message.ackWithResponse();
            });


        cancellationSubscription.on("message", async (message) => {

            console.log(`[Pipeline ${workerId}] Received cancellation message: ${message.data.toString()}`);
            try {
                const payload = JSON.parse(message.data.toString());
                if (payload.projectId) {

                    await logContextStore.run({ ...logContext, projectId: payload.projectId, shouldPublishLog: true }, async () => {
                        await workflowOperator.stopPipeline(payload.projectId);
                    });
                }
            } catch (err) {
                console.error("Error processing cancellation message:", err);
            }
            await message.ackWithResponse();
        });

            const publishCancellation = async (projectId: string) => {

                const dataBuffer = Buffer.from(JSON.stringify({ projectId }));
                await videoCancellationsTopic.publishMessage({
                    data: dataBuffer,
                    attributes: { type: "CANCEL" }
                });
            };

            pipelineCommandsSubscription.on("message", async (message) => {

                let command: PipelineCommand | undefined;
                try {
                    command = JSON.parse(message.data.toString()) as PipelineCommand;
                } catch (error) {
                    console.error("[Pipeline Command]: Error parsing command:", error);
                    await message.ackWithResponse();
                    return;
                }
                await message.ackWithResponse();

                try {
                    await logContextStore.run({
                        ...logContext,
                        projectId: command.projectId,
                        commandId: command.commandId,
                        shouldPublishLog: true
                    }, async () => {

                        console.log(`[Pipeline Command] Received command: ${command.type} for projectId: ${command.projectId} (Msg ID: ${message.id}, Attempt: ${message.deliveryAttempt})`);
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
                jobLifecycleMonitor.stop();

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
    });
}

main().catch(console.error);
