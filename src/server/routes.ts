// src/server/routes.ts
import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { PubSub, Subscription } from "@google-cloud/pubsub";
import {
  PIPELINE_COMMANDS_TOPIC_NAME,
  PIPELINE_EVENTS_TOPIC_NAME,
  SERVER_PIPELINE_EVENTS_SUBSCRIPTION
} from "../shared/constants";
import { PipelineCommand, PipelineEvent } from "../shared/types/pubsub.types";
import { v4 as uuidv4 } from "uuid";
import { Bucket } from "@google-cloud/storage";
import multer from "multer";
import { GCPStorageManager } from "../workflow/storage-manager";
import { ProjectRepository } from "src/pipeline/project-repository";
import { AssetVersionManager } from "src/workflow/asset-version-manager";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  bucket: Bucket,
): Promise<Server> {

  const projectRepository = new ProjectRepository();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB limit
    },
  });

  const clientConnections = new Map<string, Set<Response>>();

  let pubsub: PubSub;
  let pipelineCommandsTopicPublisher: ReturnType<PubSub[ 'topic' ]>;

  try {
    pubsub = new PubSub({
      projectId: process.env.GCP_PROJECT_ID,
      apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
    });

    pipelineCommandsTopicPublisher = pubsub.topic(PIPELINE_COMMANDS_TOPIC_NAME);
  } catch (error) {
    console.error(`[Server] FATAL: PubSub initialization failed:`, error);
    console.error(`[Server] Service cannot start without PubSub. Shutting down...`);
    throw error; // Re-throw to prevent server from starting
  }


  let sharedEventsSubscription: Subscription;

  async function ensureSharedSubscription() {
    if (!sharedEventsSubscription) {
      try {
        [ sharedEventsSubscription ] = await pubsub
          .topic(PIPELINE_EVENTS_TOPIC_NAME)
          .subscription(SERVER_PIPELINE_EVENTS_SUBSCRIPTION)
          .get({ autoCreate: true });

        console.log(`✓ Using shared subscription: ${SERVER_PIPELINE_EVENTS_SUBSCRIPTION}`);

        sharedEventsSubscription.on("message", (message) => {
          try {

            const event = JSON.parse(message.data.toString()) as PipelineEvent;
            const projectId = event.projectId;
            console.log(`[Server] Received pipeline event: ${event.type} `, JSON.stringify(event));

            const clients = clientConnections.get(projectId);

            switch (event.type) {
              case "LLM_INTERVENTION_NEEDED":
                console.log(`[Server] Forwarding LLM_INTERVENTION_NEEDED for projectId: ${projectId}`, event.payload);
                break;

              case "FULL_STATE":
              case "INTERVENTION_RESOLVED":
              case "SCENE_STARTED":
              case "SCENE_PROGRESS":
              case "SCENE_COMPLETED":
              case "SCENE_SKIPPED":
              case "WORKFLOW_STARTED":
              case "WORKFLOW_COMPLETED":
              case "WORKFLOW_FAILED":
              case "LOG":
                if (clients) {
                  const eventString = `data: ${JSON.stringify(event)}\n\n`;
                  clients.forEach(res => {
                    try {
                      res.write(eventString);
                    } catch (err) {
                      console.error(`Failed to write to client:`, err);
                      clients.delete(res);
                    }
                  });
                }

              default:
                console.log(`Unknown pipeline event type: ${JSON.stringify(event)}`);
            }
            message.ack();

          } catch (error) {
            console.error(`Failed to process message:`, error);
            message.nack();
          }
        });

        sharedEventsSubscription.on("error", (error: any) => {
          console.error(`Shared subscription error:`, error);
        });
      } catch (error) {
        console.error(`Failed to create shared subscription:`, error);
        throw error;
      }
    }

    return sharedEventsSubscription;
  }

  async function publishCommand<T extends PipelineCommand[ "type" ]>(
    command: Omit<Extract<PipelineCommand, { type: T; }>, "timestamp"> & { type: T; commandId: string; }
  ) {
    const fullCommand = {
      ...command,
      ...("payload" in command ? { payload: command.payload } : {}),
      timestamp: new Date().toISOString(),
      commandId: command.commandId || uuidv4(),
    };
    const dataBuffer = Buffer.from(JSON.stringify(fullCommand));
    await pipelineCommandsTopicPublisher.publishMessage({ data: dataBuffer });
    return fullCommand.commandId;
  }


  // ============================================================================
  // API Routes
  // ============================================================================

  app.post("/api/video/start", async (
    req: Request<any, any, Extract<PipelineCommand, { type: "START_PIPELINE"; }>>,
    res: Response
  ) => {
    try {
      const {
        projectId = uuidv4(),
        commandId = uuidv4(),
        payload,
      } = req.body;
      console.log(`Received START_PIPELINE command for projectId: ${projectId}`);
      if (!payload.initialPrompt) {
        console.error("Validation error: prompt missing.", { initialPrompt: payload.initialPrompt });
        return res.status(400).json({ error: "prompt is required." });
      }

      const finalCommandId = await publishCommand({ type: "START_PIPELINE", projectId, payload, commandId });
      console.log(`Published START_PIPELINE (id: ${finalCommandId}) for ${projectId}`);
      res.status(202).json({
        message: "Pipeline start command issued.",
        projectId: projectId,
        commandId: finalCommandId,
      });
    } catch (error) {
      console.error("Error publishing START_PIPELINE command:", error);
      res.status(500).json({ error: "Failed to issue start command." });
    }
  });

  app.post("/api/video/stop", async (
    req: Request<any, any, Extract<PipelineCommand, { type: "STOP_PIPELINE"; }>>,
    res: Response) => {
    try {
      const { projectId, commandId = uuidv4() } = req.body;
      if (!projectId) return res.status(400).json({ error: "projectId is required." });
      const finalCommandId = await publishCommand({ type: "STOP_PIPELINE", projectId, commandId });

      res.status(202).json({ message: "Pipeline stop command issued.", projectId, commandId: finalCommandId });
    } catch (error) {
      console.error("Error publishing stop command:", error);
      res.status(500).json({ error: "Failed to issue stop command." });
    }
  });

  app.post("/api/video/:projectId/resume", async (
    req: Request<any, any, Extract<PipelineCommand, { type: "RESUME_PIPELINE"; }>>,
    res: Response) => {
    try {
      const { projectId } = req.params;
      const { commandId = uuidv4() } = req.body;
      const finalCommandId = await publishCommand({ type: "RESUME_PIPELINE", projectId, commandId });

      res.status(202).json({ message: "Pipeline resume command issued.", projectId, commandId: finalCommandId });
    } catch (error) {
      console.error("Error publishing resume command:", error);
      res.status(500).json({ error: "Failed to issue resume command." });
    }
  });

  app.post("/api/video/:projectId/regenerate-scene", async (
    req: Request<any, any, Extract<PipelineCommand, { type: "REGENERATE_SCENE"; }>>,
    res: Response
  ) => {
    try {
      const { projectId } = req.params;
      const { payload, commandId = uuidv4() } = req.body;

      if (!payload.sceneId) return res.status(400).json({ error: "sceneId is required." });

      const finalCommandId = await publishCommand({
        type: "REGENERATE_SCENE",
        projectId,
        payload,
        commandId,
      });

      res.status(202).json({ message: "Scene regeneration command issued.", projectId, commandId: finalCommandId });
    } catch (error) {
      console.error("Error publishing regenerate scene command:", error);
      res.status(500).json({ error: "Failed to issue regenerate scene command." });
    }
  });

  app.post("/api/video/:projectId/regenerate-frame", async (
    req: Request<any, any, Extract<PipelineCommand, { type: "REGENERATE_FRAME"; }>>,
    res: Response
  ) => {
    try {
      const { projectId } = req.params;
      const { payload, commandId = uuidv4() } = req.body;

      const missingParams = [];
      if (!payload.sceneId) missingParams.push('sceneId');
      if (!payload.frameType) missingParams.push('frameType');
      if (!payload.promptModification) missingParams.push('promptModification');

      if (missingParams.length) {
        return res.status(400).json({ error: `Required params are missing: ${missingParams.join(', ')}.` });
      }

      const finalCommandId = await publishCommand({
        type: "REGENERATE_FRAME",
        projectId,
        payload,
        commandId,
      });
      res.status(202).json({ message: "Frame regeneration command issued.", projectId, commandId: finalCommandId });
    } catch (error) {
      console.error("Error publishing regenerate frame command:", error);
      res.status(500).json({ error: "Failed to issue regenerate frame command." });
    }
  });

  app.post("/api/video/:projectId/resolve-intervention", async (
    req: Request<any, any, Extract<PipelineCommand, { type: "RESOLVE_INTERVENTION"; }>>,
    res: Response
  ) => {
    try {
      const { projectId } = req.params;
      const { payload, commandId = uuidv4() } = req.body;

      if (!projectId) return res.status(400).json({ error: "projectId is required." });
      if (!payload.action) return res.status(400).json({ error: "action is required." });

      const finalCommandId = await publishCommand({
        type: "RESOLVE_INTERVENTION",
        projectId,
        payload,
        commandId
      });

      res.status(202).json({ message: "Intervention resolution command issued.", projectId, commandId: finalCommandId });
    } catch (error) {
      console.error("Error publishing resolve intervention command:", error);
      res.status(500).json({ error: "Failed to issue resolve intervention command." });
    }
  });

  app.post("/api/video/:projectId/request-state", async (
    req: Request<any, any, Extract<PipelineCommand, { type: "REQUEST_FULL_STATE"; }>>,
    res: Response
  ) => {
    try {
      const { projectId } = req.params;
      const { commandId = uuidv4() } = req.body;
      const finalCommandId = await publishCommand({ type: "REQUEST_FULL_STATE", projectId, commandId });

      res.status(202).json({ message: "Full state request command issued.", projectId, commandId: finalCommandId });
    } catch (error) {
      console.error("Error publishing request state command:", error);
      res.status(500).json({ error: "Failed to issue request state command." });
    }
  });

  app.get("/api/video/:projectId/scene/:sceneId/assets", async (
    req: Request,
    res: Response
  ) => {
    try {
      const { projectId, sceneId } = req.params;
      const assets = new AssetVersionManager(projectRepository).getAllSceneAssets(sceneId);
      res.json(assets);
    } catch (error) {
      console.error("Error getting scene assets:", error);
      res.status(500).json({ error: "Failed to get scene assets." });
    }
  });

  app.post("/api/video/:projectId/scene/:sceneId/asset", async (
    req: Request<any, any, Extract<PipelineCommand, { type: "UPDATE_SCENE_ASSET"; }>>,
    res: Response
  ) => {
    try {
      const { projectId } = req.params;
      const { payload: { scene, assetKey, version }, commandId = uuidv4() } = req.body;

      if (!assetKey) return res.status(400).json({ error: "asset type is required." });

      const finalCommandId = await publishCommand({
        type: "UPDATE_SCENE_ASSET",
        projectId,
        payload: {
          scene,
          assetKey: assetKey,
          version: version
        },
        commandId
      });

      res.status(202).json({ message: "Asset update command issued.", projectId, commandId: finalCommandId });
    } catch (error) {
      console.error("Error publishing update scene asset command:", error);
      res.status(500).json({ error: "Failed to issue update scene asset command." });
    }
  });

  // SSE endpoint for a specific project
  app.get("/api/events/:projectId", async (req: Request, res: Response) => {
    const { projectId, commandId = uuidv4() } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();


    try {
      await ensureSharedSubscription();

      if (!clientConnections.has(projectId)) {
        clientConnections.set(projectId, new Set());
      }
      clientConnections.get(projectId)!.add(res);

      console.log(`✓ Client connected for ${projectId} (${clientConnections.get(projectId)!.size} total)`);

      await publishCommand({ type: "REQUEST_FULL_STATE", projectId, commandId });

      req.on("close", async () => {
        const clients = clientConnections.get(projectId);

        if (clients) {
          clients.delete(res);
          console.log(`Client disconnected from ${projectId} (${clients.size} remaining)`);

          if (clients.size === 0) {
            clientConnections.delete(projectId);
          }
        }
        res.end();
      });

    } catch (error) {
      console.error(`Failed to establish SSE for ${projectId}:`, error);
      res.status(500).send({ error: "Failed to establish event stream." });
    }
  });

  app.post("/api/upload-audio", upload.single("audio"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file provided." });
      }

      const blob = bucket.file(`audio/${uuidv4()}-${req.file.originalname}`);
      const blobStream = blob.createWriteStream();

      blobStream.on("error", (err) => {
        console.error("Blob stream error:", err);
        res.status(500).json({ error: "Unable to upload audio." });
      });

      blobStream.on("finish", () => {
        const audioPublicUri = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
        const audioGcsUri = `gs://${bucket.name}/${blob.name}`;
        res.status(200).json({ audioPublicUri, audioGcsUri });
      });

      blobStream.end(req.file.buffer);
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Upload failed." });
    }
  });

  app.get("/api/projects", async (req, res) => {
    const projects = await projectRepository.getProjects();
    res.json({ projects });
  });

  return httpServer;
}
