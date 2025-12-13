import { PubSub } from "@google-cloud/pubsub";
import { Command, PipelineEvent } from "../shared/pubsub-types";
import { GraphState, InitialGraphState } from "../shared/pipeline-types";
import { CinematicVideoWorkflow } from "../pipeline/graph";
import { checkpointerManager } from "./checkpointer-manager";
import { RunnableConfig } from "@langchain/core/runnables";

const pubsub = new PubSub({
    projectId: process.env.PUBSUB_PROJECT_ID,
    apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
});

const VIDEO_COMMANDS_TOPIC_NAME = "video-commands";
const VIDEO_EVENTS_TOPIC_NAME = "video-events";
const PIPELINE_WORKER_SUBSCRIPTION_NAME = "pipeline-worker-subscription";

const videoEventsTopic = pubsub.topic(VIDEO_EVENTS_TOPIC_NAME);

async function publishPipelineEvent(event: PipelineEvent) {
    const dataBuffer = Buffer.from(JSON.stringify(event));
    await videoEventsTopic.publishMessage({ data: dataBuffer });
}

async function handleStartPipelineCommand(command: Extract<Command, { type: "START_PIPELINE"; }>) {
    const { projectId, payload } = command;

    const bucketName = process.env.GCP_BUCKET_NAME;
    if (!bucketName) {
        throw new Error("GCP_BUCKET_NAME environment variable not set.");
    }

    // Use the projectId as the thread_id for LangGraph checkpointing
    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    const checkpointer = await checkpointerManager.getCheckpointer();
    if (!checkpointer) {
        throw new Error("Checkpointer not initialized");
    }

    let initialState: InitialGraphState;
    const existingCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);

    if (existingCheckpoint) {
        console.log(`Resuming pipeline for projectId: ${projectId} from checkpoint.`);
        // LangGraph automatically resumes from the checkpoint if initial state is null or empty for stream
        // We still need to construct a workflow to get the compiled graph
        const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
        const compiledGraph = workflow.graph.compile({ checkpointer });
        const stream = await compiledGraph.stream(null, runnableConfig);

        for await (const step of stream) {
            const [ state ] = Object.values(step);
            await publishPipelineEvent({
                type: "FULL_STATE",
                projectId,
                payload: { state: state as GraphState },
                timestamp: new Date().toISOString(),
            });
        }
    } else {
        console.log("Starting new pipeline for projectId:", projectId);

        initialState = {
            initialPrompt: payload.audioUrl,
            creativePrompt: payload.creativePrompt,
            audioGcsUri: payload.audioUrl, // Assuming audioUrl is the GCS URI
            hasAudio: !!payload.audioUrl,
            currentSceneIndex: 0,
            errors: [],
            generationRules: [],
            refinedRules: [],
        };

        const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
        const compiledGraph = workflow.graph.compile({ checkpointer });
        const stream = await compiledGraph.stream(initialState, runnableConfig);

        for await (const step of stream) {
            const [ state ] = Object.values(step);
            await publishPipelineEvent({
                type: "FULL_STATE",
                projectId,
                payload: { state: state as GraphState },
                timestamp: new Date().toISOString(),
            });
        }
    }
}

async function handleRequestFullStateCommand(command: Extract<Command, { type: "REQUEST_FULL_STATE"; }>) {
    const { projectId } = command;
    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    const checkpointer = await checkpointerManager.getCheckpointer();
    if (!checkpointer) {
        throw new Error("Checkpointer not initialized");
    }

    const checkpoint = await checkpointerManager.loadCheckpoint(runnableConfig);
    if (checkpoint && checkpoint.channel_values) {
        await publishPipelineEvent({
            type: "FULL_STATE",
            projectId,
            payload: { state: checkpoint.channel_values as GraphState },
            timestamp: new Date().toISOString(),
        });
    } else {
        console.warn(`No checkpoint found for projectId: ${projectId}`);
    }
}

async function handleRetrySceneCommand(command: Extract<Command, { type: "RETRY_SCENE"; }>) {
    const { projectId, payload } = command;
    console.log(`Retrying scene ${payload.sceneId} for projectId: ${projectId}`);

    const bucketName = process.env.GCP_BUCKET_NAME;
    if (!bucketName) {
        throw new Error("GCP_BUCKET_NAME environment variable not set.");
    }

    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };

    const checkpointer = await checkpointerManager.getCheckpointer();
    if (!checkpointer) {
        throw new Error("Checkpointer not initialized");
    }

    const existingCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);
    if (!existingCheckpoint) {
        console.warn(`No checkpoint found to retry scene for projectId: ${projectId}`);
        return;
    }

    let currentState = existingCheckpoint.channel_values as GraphState;

    // Modify the state to retry the specified scene
    // This typically means setting the currentSceneIndex back to the scene to retry
    // and potentially clearing out any generated data for that scene if it's meant to be re-generated.
    const sceneIndexToRetry = currentState.storyboardState?.scenes.findIndex(s => s.id === parseInt(payload.sceneId, 10));

    if (sceneIndexToRetry !== undefined && sceneIndexToRetry !== -1) {
        currentState = {
            ...currentState,
            currentSceneIndex: sceneIndexToRetry,
            // Optionally, clear generated video/frames for the retried scene to force regeneration
            storyboardState: currentState.storyboardState ? {
                ...currentState.storyboardState,
                scenes: currentState.storyboardState.scenes.map((scene, index) => {
                    if (index >= sceneIndexToRetry) {
                        return { ...scene, generatedVideo: undefined, startFrame: undefined, endFrame: undefined, evaluation: undefined };
                    }
                    return scene;
                })
            } : undefined as any,
        };

        // Save the modified state to the checkpointer
        // The `put` method needs the full state, not just a partial object
        const workflow = new CinematicVideoWorkflow(process.env.GCP_PROJECT_ID!, projectId, bucketName);
        const compiledGraph = workflow.graph.compile({ checkpointer });

        // LangGraph's checkpointer.put expects the *current* state of the graph. The LangGraph `stream` method will handle saving updates implicitly.
        // So, we just need to ensure the checkpoint is updated, and then restart the stream.
        await checkpointer.put(runnableConfig, { ...existingCheckpoint, channel_values: currentState }, {} as any, {});

        console.log(`Pipeline for projectId: ${projectId} restarting from scene ${payload.sceneId}.`);
        const stream = await compiledGraph.stream(null, runnableConfig); // Start from null input to resume from checkpoint

        for await (const step of stream) {
            const [ state ] = Object.values(step);
            await publishPipelineEvent({
                type: "FULL_STATE",
                projectId,
                payload: { state: state as GraphState },
                timestamp: new Date().toISOString(),
            });
        }
    } else {
        console.warn(`Scene ${payload.sceneId} not found in pipeline for projectId: ${projectId}`);
    }
}

async function handleStopPipelineCommand(command: Extract<Command, { type: "STOP_PIPELINE"; }>) {
    const { projectId } = command;
    console.log(`Stopping pipeline for projectId: ${projectId}`);

    // For now, stopping means saving the current state (if any) and effectively ending the process's management of it.
    // LangGraph's stream will naturally end, and its state will be saved as a checkpoint.
    // If a more forceful termination is needed, it would involve more complex process management.

    // We'll rely on the streaming loop to gracefully complete/checkpoint the last known state.
    // A future enhancement could involve explicit termination signals to the LangGraph process if it's external.
    // For now, we'll just acknowledge the command and let the worker eventually stop processing this stream.
    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: projectId },
    };
    // Optionally, load and save to ensure latest state is persisted on explicit stop
    const checkpointer = await checkpointerManager.getCheckpointer();
    if (!checkpointer) {
        throw new Error("Checkpointer not initialized");
    }
    const currentCheckpoint = await checkpointerManager.loadCheckpoint(runnableConfig);
    if (currentCheckpoint) {
        await checkpointerManager.saveCheckpoint(runnableConfig, currentCheckpoint);
        console.log(`Pipeline for ${projectId} stopped and state checkpointed.`);
    } else {
        console.warn(`No active pipeline or checkpoint found to stop for projectId: ${projectId}`);
    }
}


async function main() {
    console.log("Starting pipeline worker...");

    // Initialize the checkpointer manager FIRST
    await checkpointerManager.getCheckpointer();

    const [ videoCommandsTopic ] = await pubsub.topic(VIDEO_COMMANDS_TOPIC_NAME).get({ autoCreate: true });
    await pubsub.topic(VIDEO_EVENTS_TOPIC_NAME).get({ autoCreate: true });
    await videoCommandsTopic.subscription(PIPELINE_WORKER_SUBSCRIPTION_NAME).get({ autoCreate: true });

    const pipelineCommandsSubscription = pubsub.subscription(PIPELINE_WORKER_SUBSCRIPTION_NAME);
    console.log(`Listening for commands on ${PIPELINE_WORKER_SUBSCRIPTION_NAME}...`);

    pipelineCommandsSubscription.on("message", async (message) => {
        try {
            const command = JSON.parse(message.data.toString()) as Command;
            console.log(`Received command: ${command.type} for projectId: ${command.projectId}`);

            switch (command.type) {
                case "START_PIPELINE":
                    await handleStartPipelineCommand(command);
                    break;
                case "REQUEST_FULL_STATE":
                    await handleRequestFullStateCommand(command);
                    break;
                case "RETRY_SCENE":
                    await handleRetrySceneCommand(command);
                    break;
                case "STOP_PIPELINE":
                    await handleStopPipelineCommand(command);
                    break;
            }
            message.ack();
        } catch (error) {
            console.error("Error processing message:", error);
            message.nack();
        }
    });

    // Graceful shutdown
    process.on("SIGINT", () => {
        console.log("Shutting down worker...");
        pipelineCommandsSubscription.close();
        process.exit(0);
    });
}

main().catch(console.error);
