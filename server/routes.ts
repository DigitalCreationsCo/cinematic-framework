import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { PubSub } from "@google-cloud/pubsub";
import { Command, PipelineEvent } from "../shared/pubsub-types";
import { v4 as uuidv4 } from "uuid";
import { Bucket } from "@google-cloud/storage";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  bucket: Bucket,
): Promise<Server> {

  const pubsub = new PubSub({
    projectId: process.env.PUBSUB_PROJECT_ID,
    apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
  });

  const VIDEO_COMMANDS_TOPIC_NAME = "video-commands";
  const VIDEO_EVENTS_TOPIC_NAME = "video-events";
  const videoCommandsTopicPublisher = pubsub.topic(VIDEO_COMMANDS_TOPIC_NAME);

  app.post("/api/video/start", async (req: Request, res: Response) => {
    try {
      const { projectId, audioUrl, creativePrompt } = req.body;

      if (!projectId || !creativePrompt) {
        return res.status(400).json({ error: "projectId and creativePrompt are required." });
      }

      const command: Command = {
        type: "START_PIPELINE",
        projectId,
        payload: {
          audioUrl,
          creativePrompt,
        },
        timestamp: new Date().toISOString(),
      };

      const dataBuffer = Buffer.from(JSON.stringify(command));
      await videoCommandsTopicPublisher.publishMessage({ data: dataBuffer });

      res.status(202).json({ message: "Pipeline start command issued.", projectId });

    } catch (error) {
      console.error("Error publishing start command:", error);
      res.status(500).json({ error: "Failed to issue start command." });
    }
  });

  // Endpoint to stop the pipeline
  app.post("/api/video/stop", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.body;

      if (!projectId) {
        return res.status(400).json({ error: "projectId is required." });
      }

      const command: Command = {
        type: "STOP_PIPELINE",
        projectId,
        payload: {},
        timestamp: new Date().toISOString(),
      };

      const dataBuffer = Buffer.from(JSON.stringify(command));
      await videoCommandsTopicPublisher.publishMessage({ data: dataBuffer });

      res.status(202).json({ message: "Pipeline stop command issued.", projectId });

    } catch (error) {
      console.error("Error publishing stop command:", error);
      res.status(500).json({ error: "Failed to issue stop command." });
    }
  });

  // SSE endpoint for a specific project
  app.get("/api/events/:projectId", async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const clientSseSubscriptionId = `server-sse-${projectId}-${uuidv4()}`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let eventStreamSubscriptionHandle: any;

    try {
      // 1. Create a temporary, exclusive subscription for this client
      [ eventStreamSubscriptionHandle ] = await pubsub
        .topic(VIDEO_EVENTS_TOPIC_NAME)
        .createSubscription(clientSseSubscriptionId, {
          // Automatically delete subscription after 1 hour of inactivity
          expirationPolicy: { ttl: { seconds: 3600 } },
        });

      console.log(`Created SSE subscription ${clientSseSubscriptionId} for projectId ${projectId}`);

      // 2. Request the full state from the pipeline worker
      const initialStateRequestCommand: Command = {
        type: "REQUEST_FULL_STATE",
        projectId,
        payload: {},
        timestamp: new Date().toISOString(),
      };
      const dataBuffer = Buffer.from(JSON.stringify(initialStateRequestCommand));
      await videoCommandsTopicPublisher.publishMessage({ data: dataBuffer });

      // 3. Listen for messages and forward them to the client
      eventStreamSubscriptionHandle.on("message", (message: any) => {
        const event = JSON.parse(message.data.toString()) as PipelineEvent;
        // Ensure we only send events for the requested projectId
        if (event.projectId === projectId) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        message.ack();
      });

      eventStreamSubscriptionHandle.on("error", (error: any) => {
        console.error(`SSE subscription error for ${clientSseSubscriptionId}:`, error);
        res.end();
      });

      // 4. Clean up when the client disconnects
      req.on("close", async () => {
        console.log(`Client disconnected for ${projectId}. Deleting SSE subscription ${clientSseSubscriptionId}.`);
        await eventStreamSubscriptionHandle.delete();
        res.end();
      });

    } catch (error) {
      console.error(`Failed to create SSE handler for projectId ${projectId}:`, error);
      res.status(500).send({ error: "Failed to establish event stream." });
    }
  });

  app.get("/api/state", async (req, res) => {
    const [
      metadata,
      scenes,
      characters,
      locations,
      metrics,
      sceneStatuses,
      messages,
      projects,
    ] = await Promise.all([
      storage.getMetadata(),
      storage.getScenes(),
      storage.getCharacters(),
      storage.getLocations(),
      storage.getMetrics(),
      storage.getSceneStatuses(),
      storage.getMessages(),
      storage.getProjects(),
    ]);
    res.json({
      storyboardState: {
        scenes,
        characters,
        locations,
        metadata,
      },
      metrics,
      sceneStatuses,
      messages,
      projects,
    });
  });

  app.get("/api/projects", async (req, res) => {
    const [ , , apiResponse ]: any = await bucket.getFiles({
      delimiter: "/",
    });

    const excludeDirs = ["audio"]
    const projects: string[] = ((apiResponse.prefixes ?? []) as string[]).map(prefix => prefix.replace(/\/$/, "")).filter(prefix => !excludeDirs.includes(prefix))

    res.json({ projects });
  });

  return httpServer;
}
