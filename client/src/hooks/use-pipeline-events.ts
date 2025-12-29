import { useEffect } from "react";
import { useStore } from "../lib/store";
import { PipelineEvent } from "@shared/pubsub-types";
import { GraphState } from "@shared/pipeline-types";
import { requestFullState } from "../lib/api";

interface UsePipelineEventsProps {
  projectId: string | null;
}

export function usePipelineEvents({ projectId }: UsePipelineEventsProps) {
  const {
    setPipelineState,
    setIsHydrated,
    setIsLoading,
    setError,
    setConnectionStatus,
    updateScene,
    setPipelineStatus,
    addMessage,
    setInterruptionState,
    setSelectedSceneId
  } = useStore();

  const isHydrated = useStore(state => state.isHydrated);

  useEffect(() => {
    if (!projectId) {
      setConnectionStatus("disconnected");
      setPipelineState(null);
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
      console.log(`SSE Connected for projectId: ${projectId}`);

      requestFullState({ projectId: projectId }).catch(err => console.error("Failed to request full state on connect:", err));
    };

    eventSource.onmessage = (event) => {
      try {
        setIsLoading(true);
        const parsedEvent = JSON.parse(event.data) as PipelineEvent;

        console.log(`[SSE] Received: ${parsedEvent.type}`, parsedEvent.payload);

        switch (parsedEvent.type) {
          case "WORKFLOW_STARTED":
            if (parsedEvent.payload && 'initialState' in parsedEvent.payload) {
              setPipelineState(parsedEvent.payload.initialState as GraphState);
              setIsLoading(false);
              setPipelineStatus("analyzing");
            }
            break;

          case "FULL_STATE":
            const newState = parsedEvent.payload.state;
            setPipelineState(newState);

            // if (newState.currentSceneIndex > (newState.storyboardState?.scenes.length || 0)) {
            //   setPipelineStatus("complete");
            // } else if (newState.currentSceneIndex > 0) {
            //   setPipelineStatus("ready");
            // }

            if (!isHydrated) {
              setIsHydrated(true);
              setIsLoading(false);
              console.log(`Pipeline state hydrated for projectId: ${projectId}`);
            }
            break;

          case "SCENE_STARTED":
            updateScene(parsedEvent.payload.sceneId, { status: "generating" });
            setSelectedSceneId(parsedEvent.payload.sceneId);
            setPipelineStatus("generating");
            break;

          case "SCENE_PROGRESS":
            updateScene(parsedEvent.payload.sceneId, (scene) => ({
              status: parsedEvent.payload.status || "generating",
              progressMessage: parsedEvent.payload.progressMessage,
              startFrame: parsedEvent.payload.startFrame || scene.startFrame,
              endFrame: parsedEvent.payload.endFrame || scene.endFrame,
              generatedVideo: parsedEvent.payload.generatedVideo || scene.generatedVideo,
            }));
            setSelectedSceneId(parsedEvent.payload.sceneId);
            setPipelineStatus("generating");
            break;

          case "SCENE_COMPLETED":
            // Wait for next FULL_STATE to get complete scene data
            // Just update status for immediate UI feedback
            updateScene(parsedEvent.payload.sceneId, {
              status: "complete",
              progressMessage: ""
            });
            break;

          case "SCENE_SKIPPED":
            // updateScene(parsedEvent.payload.sceneId, { status: "skipped" });
            break;

          case "LOG":
            // Filter out noisy logs
            const level = parsedEvent.payload.level;
            if (level === "error" || level === "warning" ||
              parsedEvent.payload.message.includes("✓") ||
              parsedEvent.payload.message.includes("✗")) {
              addMessage({
                id: crypto.randomUUID(),
                type: level,
                message: parsedEvent.payload.message,
                timestamp: new Date(parsedEvent.timestamp),
                sceneId: parsedEvent.payload.sceneId
              });
            }
            break;

          case "WORKFLOW_COMPLETED":
            setPipelineState(parsedEvent.payload.finalState);
            setPipelineStatus("complete");
            break;

          case "WORKFLOW_FAILED":
            setError(parsedEvent.payload.error);
            setPipelineStatus("error");
            setIsLoading(false);
            addMessage({
              id: crypto.randomUUID(),
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
            setPipelineStatus("paused");
            addMessage({
              id: crypto.randomUUID(),
              type: "warning",
              message: `Paused. Intervention required: ${parsedEvent.payload.error}`,
              timestamp: new Date(parsedEvent.timestamp)
            });
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
  }, [ projectId, isHydrated, setConnectionStatus, setError, setIsLoading, setIsHydrated, setPipelineState, updateScene, setPipelineStatus ]);

  return {

  };
}
