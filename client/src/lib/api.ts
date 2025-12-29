import { PipelineCommand } from "@shared/pubsub-types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

async function sendCommand<T>(endpoint: string, body: T): Promise<{ projectId: string; message: string; commandId: string; }> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `Failed to send command to ${endpoint}.`);
  }

  return response.json();
}

// ============================================================================
// Pipeline Control Commands
// ============================================================================

export const startPipeline = (args: Omit<Extract<PipelineCommand, { type: "START_PIPELINE"; }>, "type" | "timestamp">) =>
  sendCommand("/video/start", args); 

export const stopPipeline = (args: Omit<Extract<PipelineCommand, { type: "STOP_PIPELINE"; }>, "type" | "timestamp">) =>
  sendCommand("/video/stop", args);

export const resumePipeline = (args: Omit<Extract<PipelineCommand, { type: "RESUME_PIPELINE"; }>, "type" | "timestamp">) =>
  sendCommand(`/video/${args.projectId}/resume`, args);

export const regenerateScene = (args: Omit<Extract<PipelineCommand, { type: "REGENERATE_SCENE"; }>, "type" | "timestamp">) =>
  sendCommand(`/video/${args.projectId}/regenerate-scene`, args);

export const regenerateFrame = (args: Omit<Extract<PipelineCommand, { type: "REGENERATE_FRAME"; }>, "type" | "timestamp">) =>
  sendCommand(`/video/${args.projectId}/regenerate-frame`, args);

export const updateSceneAsset = (args: Omit<Extract<PipelineCommand, { type: "UPDATE_SCENE_ASSET"; }>, "type" | "timestamp">) =>
  sendCommand(`/video/${args.projectId}/scene/${args.payload.sceneId}/asset`, args);

export const resolveIntervention = (args: Omit<Extract<PipelineCommand, { type: "RESOLVE_INTERVENTION"; }>, "type" | "timestamp">) =>
  sendCommand(`/video/${args.projectId}/resolve-intervention`, args);


// ============================================================================
// Data Fetching
// ============================================================================

export const requestFullState = (args: Omit<Extract<PipelineCommand, { type: "REQUEST_FULL_STATE"; }>, "type" | "timestamp">) =>
  sendCommand(`/video/${args.projectId}/request-state`, args);

export const getSceneAssets = async (projectId: string, sceneId: number): Promise<{
  startFrames: { attempt: number, url: string, timestamp: string }[];
  endFrames: { attempt: number, url: string, timestamp: string }[];
  videos: { attempt: number, url: string, timestamp: string }[];
}> => {
  const response = await fetch(`${API_BASE_URL}/video/${projectId}/scene/${sceneId}/assets`);
  if (!response.ok) {
    throw new Error("Failed to fetch scene assets.");
  }
  return response.json();
};

export const uploadAudio = async (file: File): Promise<{ audioPublicUri: string; audioGcsUri: string; }> => {
  const formData = new FormData();
  formData.append("audio", file);

  const response = await fetch(`${API_BASE_URL}/upload-audio`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to upload audio.");
  }

  return response.json();
};

export const getProjects = async (): Promise<{ id: string; createdAt: string; }[]> => {
  const response = await fetch(`${API_BASE_URL}/projects`);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to fetch projects.");
  }
  return response.json();
};

/**
 * Get command status (optional - for debugging)
 */
export async function getCommandStatus({
  projectId,
  commandId,
}: {
  projectId: string;
  commandId: string;
}) {
  const response = await fetch(`/api/video/${projectId}/command/${commandId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get command status');
  }

  return response.json();
}