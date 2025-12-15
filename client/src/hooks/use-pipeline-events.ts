import { useEffect } from "react";
import { useStore } from "../lib/store";
import { PipelineEvent } from "@shared/pubsub-types";
import { GraphState } from "@shared/pipeline-types";

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
  } = useStore(state => ({
    setPipelineState: state.setPipelineState,
    setIsHydrated: state.setIsHydrated,
    setIsLoading: state.setIsLoading,
    setError: state.setError,
    setConnectionStatus: state.setConnectionStatus,
    updateScene: state.updateScene,
    setPipelineStatus: state.setPipelineStatus,
  }));

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

    setIsLoading(true);
    setError(null);
    setConnectionStatus("connecting");

    const eventSource = new EventSource(`/api/events/${projectId}`);

    eventSource.onopen = () => {
      setConnectionStatus("connected");
      setError(null);
      console.log(`SSE Connected for projectId: ${projectId}`);
    };

    eventSource.onmessage = (event) => {
      try {
        const parsedEvent = JSON.parse(event.data) as PipelineEvent;

        switch (parsedEvent.type) {
          case "FULL_STATE":
            setPipelineState(parsedEvent.payload.state);
            if (!isHydrated) {
              setIsHydrated(true);
              setIsLoading(false);
              console.log(`Pipeline state fully hydrated for projectId: ${projectId}`);
            }
            break;

          case "WORKFLOW_STARTED":
            if (parsedEvent.payload && 'initialState' in parsedEvent.payload) {
              setPipelineState(parsedEvent.payload.initialState as GraphState);
              setIsLoading(false);
              setPipelineStatus("running");
            }
            break;

          case "SCENE_STARTED":
            updateScene(parsedEvent.payload.sceneId, { status: "generating" });
            break;

          case "SCENE_COMPLETED":
            // Here we would ideally get the updated scene object in the payload
            // For now, we just update the status. The next FULL_STATE will sync the data.
            updateScene(parsedEvent.payload.sceneId, { status: "complete", generatedVideo: { publicUri: parsedEvent.payload.videoUrl || "", storageUri: '' } });
            break;

          case "SCENE_SKIPPED":
            updateScene(parsedEvent.payload.sceneId, { status: "skipped" });
            break;

          case "WORKFLOW_COMPLETED":
            setPipelineState(parsedEvent.payload.finalState);
            setPipelineStatus("complete");
            break;

          case "WORKFLOW_FAILED":
            setError(parsedEvent.payload.error);
            setPipelineStatus("error");
            setIsLoading(false);
            break;

          case "PIPELINE_STATUS":
            setPipelineStatus(parsedEvent.payload.status);
            break;
        }
      } catch (e) {
        console.error("Failed to parse SSE event", e);
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
}
