import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export function useProjects() {
  const { data, error, isLoading } = useSWR<{ projects: string[]; }>("/api/projects", fetcher);

  return {
    data,
    isLoading,
    isError: error,
  };
}

export function useStopPipeline() {
  const { mutate: swrMutate } = useSWR<{ projects: string[]; }>("/api/projects", fetcher);

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
  return stopPipeline;
}
