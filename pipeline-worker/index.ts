import { PubSub } from "@google-cloud/pubsub";
import { PipelineCommand, PipelineEvent } from "../shared/pubsub-types";
import { ApiError as StorageApiError } from "@google-cloud/storage";
import { CheckpointerManager } from "../pipeline/checkpointer-manager";
import { AsyncLocalStorage } from "async_hooks";
import { handleStartPipelineCommand } from './handlers/handleStartPipelineCommand';
import { handleRequestFullStateCommand } from './handlers/handleRequestFullStateCommand';
import { handleResumePipelineCommand } from './handlers/handleResumePipelineCommand';
import { handleRegenerateSceneCommand } from './handlers/handleRegenerateSceneCommand';
import { handleRegenerateFrameCommand } from './handlers/handleRegenerateFrameCommand';
import { handleResolveInterventionCommand } from './handlers/handleResolveInterventionCommand';
import { handleStopPipelineCommand } from './handlers/handleStopPipelineCommand';
import { formatLoggers } from "./helpers/format-loggers";
import { WorkflowService } from "./workflow-service";
import { v4 as uuidv4 } from 'uuid';

// const lockManager = new DistributedLockManager(postgresUrl);
// await lockManager.init();

const projectIdStore = new AsyncLocalStorage<string>();

const gcpProjectId = process.env.GCP_PROJECT_ID;
if (!gcpProjectId) throw Error("A GCP projectId was not provided");

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) throw Error("Postgres URL is required for CheckpointerManager initialization");


const checkpointerManager = new CheckpointerManager(postgresUrl);
await checkpointerManager.init();


const VIDEO_COMMANDS_TOPIC_NAME = "video-commands";
const VIDEO_EVENTS_TOPIC_NAME = "video-events";
const VIDEO_CANCELLATIONS_TOPIC_NAME = "video-cancellations";
const PIPELINE_WORKER_SUBSCRIPTION_NAME = "pipeline-worker-subscription";

const workerId = uuidv4();
const cancellationSubscriptionName = `worker-${workerId}-cancellations`;

const pubsub = new PubSub({
    projectId: gcpProjectId,
    apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
});

const videoEventsTopic = pubsub.topic(VIDEO_EVENTS_TOPIC_NAME);

export async function publishPipelineEvent(event: PipelineEvent) {
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await videoEventsTopic.publishMessage({ data: dataBuffer });
}

async function main() {
    console.log(`Starting pipeline worker ${workerId}...`);

    formatLoggers(projectIdStore, publishPipelineEvent);

    const workflowService = new WorkflowService(checkpointerManager, publishPipelineEvent);

    checkpointerManager.getCheckpointer();

    const [ videoCommandsTopic ] = await pubsub.topic(VIDEO_COMMANDS_TOPIC_NAME).get({ autoCreate: true });
    await pubsub.topic(VIDEO_EVENTS_TOPIC_NAME).get({ autoCreate: true });
    await videoCommandsTopic.subscription(PIPELINE_WORKER_SUBSCRIPTION_NAME).get({ autoCreate: true });

    // Setup Cancellation Broadcast
    const [ videoCancellationsTopic ] = await pubsub.topic(VIDEO_CANCELLATIONS_TOPIC_NAME).get({ autoCreate: true });
    await videoCancellationsTopic.createSubscription(cancellationSubscriptionName);
    const cancellationSubscription = pubsub.subscription(cancellationSubscriptionName);
    console.log(`[Worker ${workerId}] Listening for cancellations on ${cancellationSubscriptionName}`);

    cancellationSubscription.on("message", async (message) => {
        try {
            const payload = JSON.parse(message.data.toString());
            if (payload.projectId) {
                // workflowService.stopPipeline will log if it stops something
                await workflowService.stopPipeline(payload.projectId);
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

    const pipelineCommandsSubscription = pubsub.subscription(PIPELINE_WORKER_SUBSCRIPTION_NAME);
    console.log(`Listening for commands on ${PIPELINE_WORKER_SUBSCRIPTION_NAME}...`);

    pipelineCommandsSubscription.on("message", async (message) => {
        let command: PipelineCommand | undefined;

        try {
            command = JSON.parse(message.data.toString()) as PipelineCommand;
        } catch (error) {
            console.error("Error parsing command:", error);
            message.ack();
            return;
        }

        console.log(`[Worker] Received command: ${command.type} for projectId: ${command.projectId} (Msg ID: ${message.id}, Attempt: ${message.deliveryAttempt})`);

        message.ack();

        try {
            await projectIdStore.run(command.projectId, async () => {
                switch (command.type) {
                    case "START_PIPELINE":
                        await handleStartPipelineCommand(command, workflowService);
                        break;
                    case "REQUEST_FULL_STATE":
                        await handleRequestFullStateCommand(command, workflowService);
                        break;
                    case "RESUME_PIPELINE":
                        await handleResumePipelineCommand(command, workflowService);
                        break;
                    case "REGENERATE_SCENE":
                        await handleRegenerateSceneCommand(command, workflowService);
                        break;
                    case "REGENERATE_FRAME":
                        await handleRegenerateFrameCommand(command, workflowService);
                        break;
                    case "RESOLVE_INTERVENTION":
                        await handleResolveInterventionCommand(command, workflowService);
                        break;
                    case "STOP_PIPELINE":
                        await handleStopPipelineCommand(command, publishCancellation);
                        break;
                }
            });
        } catch (error) {
            console.error(`[Worker] Error processing command for project ${command.projectId}:`, error);
            if (error instanceof StorageApiError) {
                pipelineCommandsSubscription.close();
                process.exit(1);
            }
        }
    });

    process.on("SIGINT", async () => {
        console.log("Shutting down worker...");
        pipelineCommandsSubscription.close();
        cancellationSubscription.close();
        try {
            console.log("Deleting ephemeral subscription...");
            await cancellationSubscription.delete();
            console.log("Deleted ephemeral cancellation subscription");
        } catch (e) {
            console.error("Failed to delete subscription (it might have been deleted already or connection failed)", e);
        }
        process.exit(0);
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            console.log("Closing pipeline subscription for HMR...");
            pipelineCommandsSubscription.close();
            cancellationSubscription.close();
        });
    }
}

main().catch(console.error);
