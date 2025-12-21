import { PipelineCommand } from "@shared/pubsub-types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

async function sendCommand<T>(endpoint: string, body: T): Promise<{ projectId: string; message: string; }> {
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

export const startPipeline = (args: Extract<PipelineCommand, { type: "START_PIPELINE"; }>[ 'payload' ] & { projectId?: string; }) =>
  sendCommand("/video/start", args);

export const stopPipeline = (args: { projectId: string; }) =>
  sendCommand("/video/stop", args);

export const resumePipeline = (args: { projectId: string; }) =>
  sendCommand(`/video/${args.projectId}/resume`, args);

export const regenerateScene = (args: Extract<PipelineCommand, { type: "REGENERATE_SCENE"; }>[ 'payload' ] & { projectId: string; }) =>
  sendCommand(`/video/${args.projectId}/regenerate-scene`, args);

export const regenerateFrame = (args: Extract<PipelineCommand, { type: "REGENERATE_FRAME"; }>[ 'payload' ] & { projectId: string; }) =>
  sendCommand(`/video/${args.projectId}/regenerate-frame`, args);


// ============================================================================
// Data Fetching
// ============================================================================

export const requestFullState = (args: { projectId: string; }) =>
  sendCommand(`/video/${args.projectId}/request-state`, args);

export const uploadAudio = async (file: File): Promise<{ publicUrl: string; gsUri: string; }> => {
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
