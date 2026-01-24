import { useEffect } from "react";
import { useStore } from "../lib/store";
import { PipelineEvent } from "#shared/types/pipeline.types";
import { Project, Scene } from "#shared/types/workflow.types";
import { requestFullState } from "../lib/api";
import { v7 as uuidv7 } from "uuid";

interface UsePipelineEventsProps {
  projectId: string | null;
}

export function usePipelineEvents({ projectId }: UsePipelineEventsProps) {
  const {
    setProject,
    setIsHydrated,
    setIsLoading,
    setError,
    setConnectionStatus,
    updateSceneClientSide,
    setProjectStatus,
    addMessage,
    setInterruptionState,
    setSelectedSceneIndex
  } = useStore();

  const isHydrated = useStore(state => state.isHydrated);

  useEffect(() => {
    if (!projectId) {
      setConnectionStatus("disconnected");
      setProject(null);
      setIsHydrated(false);
      setIsLoading(false);
      setError(null);
      return;
    }

    setError(null);
    setConnectionStatus("connecting");

    const eventSource = new EventSource(`/api/events/${projectId}`);

    eventSource.onopen = () => {
      setConnectionStatus("connected");
      setError(null);
      console.log({ projectId }, "Client connected");

      requestFullState({ projectId: projectId }).catch(error => console.error({ error }, "Failed to get project full state"));
    };

    eventSource.onmessage = (event) => {
      try {
        setIsLoading(true);
        const parsedEvent = JSON.parse(event.data) as PipelineEvent;

        console.log({ event: parsedEvent }, `Client received event.`);

        switch (parsedEvent.type) {
          case "WORKFLOW_STARTED":
            if (parsedEvent.payload.project) {
              setProject(parsedEvent.payload.project);
              setIsLoading(false);
              setProjectStatus("analyzing");
            }
            break;

          case "FULL_STATE":
            const newState = parsedEvent.payload.project;
            setProject(newState);

            if (!isHydrated) {
              setIsHydrated(true);
              setIsLoading(false);
              console.log(`Pipeline state hydrated for projectId: ${projectId}`);
            }
            break;

          case "SCENE_STARTED":
            updateSceneClientSide(parsedEvent.payload.scene.id, { status: "generating" });
            setSelectedSceneIndex(parsedEvent.payload.scene.sceneIndex);
            setProjectStatus("generating");
            break;

          case "SCENE_UPDATE":
            updateSceneClientSide(parsedEvent.payload.scene.id, (scene) => {
              const ignored = useStore.getState().ignoreAssetUrls;
              // const updates: Partial<Scene> = {
              //   status: parsedEvent.payload.status || "generating",
              //   progressMessage: parsedEvent.payload.progressMessage,
              // };

              // if (parsedEvent.payload.startFrame !== undefined) {
              //   const url = parsedEvent.payload.startFrame;
              //   if (!url || !ignored.includes(url)) {
              //     updates.startFrame = parsedEvent.payload.startFrame;
              //   }
              // }

              // if (parsedEvent.payload.endFrame !== undefined) {
              //   const url = parsedEvent.payload.endFrame;
              //   if (!url || !ignored.includes(url)) {
              //     updates.endFrame = parsedEvent.payload.endFrame;
              //   }
              // }

              // if (parsedEvent.payload.generatedVideo !== undefined) {
              //   const url = parsedEvent.payload.generatedVideo;
              //   if (!url || !ignored.includes(url)) {
              //     updates.generatedVideo = parsedEvent.payload.generatedVideo;
              //   }
              // }
              return scene;
            });
            setSelectedSceneIndex(parsedEvent.payload.scene.sceneIndex);
            setProjectStatus("generating");
            break;

          case "SCENE_COMPLETED":
            // Wait for next FULL_STATE to get complete scene data
            // Just update status for immediate UI feedback
            updateSceneClientSide(parsedEvent.payload.scene.id, {
              status: "complete",
              progressMessage: ""
            });
            break;

          case "SCENE_SKIPPED":
            // updateSceneClientSide(parsedEvent.payload.sceneId, { status: "skipped" });
            break;

          case "LOG":
            // Filter out noisy logs
            const level = parsedEvent.payload.level;
            if (level === "error" || level === "warn" ||
              parsedEvent.payload.message.includes("✓") ||
              parsedEvent.payload.message.includes("✗")) {
              addMessage({
                id: uuidv7(),
                type: level,
                message: parsedEvent.payload.message,
                timestamp: new Date(parsedEvent.timestamp),
                sceneId: parsedEvent.payload.sceneId
              });
            }
            break;

          case "WORKFLOW_COMPLETED":
            setProjectStatus("complete");
            break;

          case "WORKFLOW_FAILED":
            setError(parsedEvent.payload.error);
            setProjectStatus("error");
            setIsLoading(false);
            addMessage({
              id: uuidv7(),
              type: "error",
              message: `Workflow failed: ${parsedEvent.payload.error}`,
              timestamp: new Date(parsedEvent.timestamp)
            });
            break;

          case "LLM_INTERVENTION_NEEDED":
            console.log("Intervention needed - received event:", parsedEvent.payload);
            setInterruptionState({
              error: parsedEvent.payload.error,
              functionName: parsedEvent.payload.functionName,
              currentParams: parsedEvent.payload.params
            });
            setProjectStatus("paused");
            addMessage({
              id: uuidv7(),
              type: "warn",
              message: `Paused. Intervention required: ${parsedEvent.payload.error}`,
              timestamp: new Date(parsedEvent.timestamp)
            });
            break;
          default:
            console.log(`[Client] received unexpected event type: ${parsedEvent.type} `, JSON.stringify(parsedEvent));
            break;
        }
      } catch (e) {
        console.error("Failed to parse SSE event", e, event.data);
      }
    };

    eventSource.onerror = (err) => {
      console.error(`SSE Error for projectId ${projectId}:`, err);
      setConnectionStatus("disconnected");
      setError("Connection to event stream failed");
    };

    return () => {
      eventSource.close();
      setConnectionStatus("disconnected");
      console.log(`SSE Disconnected for projectId: ${projectId}`);
    };
  }, [ projectId, isHydrated, setConnectionStatus, setError, setIsLoading, setIsHydrated, setProject, updateSceneClientSide, setProjectStatus ]);

  return {

  };
}
