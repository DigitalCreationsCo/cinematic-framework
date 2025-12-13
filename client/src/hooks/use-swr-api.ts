import useSWR from 'swr';
import {
  type Scene,
  type Character,
  type Location,
  type WorkflowMetrics,
  type SceneStatus,
  type VideoMetadata
} from "@shared/pipeline-types";
import { type PipelineMessage } from "@shared/pipeline-types"; 

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface AppData {
  storyboardState: {
    metadata: VideoMetadata;
    scenes: Scene[];
    characters: Character[];
    locations: Location[];
  };
  metrics: WorkflowMetrics;
  sceneStatuses: Record<number, SceneStatus>;
  messages: PipelineMessage[];
  projects: string[];
}

export function useAppData(projectId: string | null, shouldFetch: boolean = true) {
  const { data, error, isLoading, mutate: swrMutate } = useSWR<AppData>(
    projectId && shouldFetch ? `/api/state?project=${projectId}` : null,
    fetcher
  );
  const { data: projectData, error: projectError, isLoading: projectIsLoading } = useSWR<{ projects: string[]; }>("/api/projects", fetcher);

  const stopPipeline = async (projectId: string) => {
    await swrMutate(
      async () => {
        const response = await fetch('/api/video/stop', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ projectId }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `API Error: ${response.statusText}`);
        }
        return response.json();
      },
      {
        revalidate: true
      }
    );
  };

  return {
    data: projectData ? { ...data, projects: projectData?.projects || [] } : undefined,
    isLoading: isLoading || projectIsLoading,
    isError: error || projectError,
    refetchState: swrMutate,
    stopPipeline,
  };
}
