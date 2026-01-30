import { useEffect, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.js";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.js";
import { ScrollArea } from "#/components/ui/scroll-area.js";
import { Button } from "#/components/ui/button.js";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "#/components/ui/resizable.js";
import {
  Film,
  Users,
  MapPin,
  BarChart3,
  MessageSquare,
  Zap,
  Clock,
  RefreshCw,
  CheckCircle,
  Bug
} from "lucide-react";
import type {
  Scene,
  Character,
  Location,
  AssetStatus,
} from "../../../shared/types/index.js";
import { getAllBestFromAssets } from "../../../shared/utils/assets-utils.js";
import PipelineHeader from "#/components/PipelineHeader.js";
import SceneCard from "#/components/SceneCard.js";
import SceneDetailPanel from "#/components/SceneDetailPanel.js";
import Timeline from "#/components/Timeline.js";
import PlaybackControls from "#/components/PlaybackControls.js";
import MessageLog from "#/components/MessageLog.js";
import CharacterCard from "#/components/CharacterCard.js";
import LocationCard from "#/components/LocationCard.js";
import MetricCard from "#/components/MetricCard.js";
import DebugStatePanel from "#/components/DebugStatePanel.js";
import { usePipelineEvents } from "#/hooks/use-pipeline-events.js";
import { useStore } from "#/lib/store.js";
import { regenerateScene, resumePipeline, startPipeline, stopPipeline } from "#/lib/api.js";
import { Skeleton } from "#/components/ui/skeleton.js";
import { useMediaPreloader } from "#/hooks/use-media-preloader.js";

export default function Dashboard() {
  const {
    isDark,
    projectStatus,
    project,
    isLoading,
    error,
    selectedSceneIndex,
    activeTab,
    setIsDark,
    setProjectStatus,
    setSelectedSceneIndex,
    setActiveTab,
    currentPlaybackTime,
    setCurrentPlaybackTime,
    resetDashboard,
    selectedProject,
    isPlaying,
    setIsPlaying,
    messages,
    addMessage,
    clearMessages,
    removeMessage,
    updateSceneClientSide
  } = useStore();

  const audioGcsUri = project?.metadata.audioGcsUri;
  const initialPrompt = project?.metadata.initialPrompt || project?.metadata.initialPrompt;

  usePipelineEvents({ projectId: selectedProject || null });

  const currentScenes = useMemo(() => project?.scenes?.reduce<Scene[]>((acc, scene) => {
    const assets = getAllBestFromAssets(scene.assets);
    const hasVideo = !!assets['scene_video']?.data;
    const status = hasVideo ? "complete" :
      ((projectStatus === "ready" || projectStatus === "paused" || projectStatus === "complete" || projectStatus === "error") && "pending") || scene.status || "pending";
    acc.push({ ...scene, status });
    return acc;
  }, []) || [], [ project?.scenes, projectStatus ]);

  const selectedScene = useMemo(() => currentScenes.find(s => s.sceneIndex === selectedSceneIndex), [ currentScenes, selectedSceneIndex ]);

  const activeTimebarScene = useMemo(() => {
    return currentScenes.find(s =>
      currentPlaybackTime >= s.startTime &&
      currentPlaybackTime < s.endTime
    );
  }, [ currentScenes, currentPlaybackTime ]);


  useMediaPreloader(currentScenes, activeTimebarScene?.id ?? selectedScene?.id ?? undefined);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [ isDark ]);

  const currentCharacters = useMemo(() => project?.characters || [], [ project ]);
  const currentLocations = useMemo(() => project?.locations || [], [ project ]);
  const currentMetadata = useMemo(() => project?.metadata, [ project ]);
  const currentMetrics = useMemo(() => project?.metrics, [ project ]);


  const selectedSceneCharacters = useMemo(() => selectedScene
    ? currentCharacters.filter(c => selectedScene.characterIds.includes(c.id))
    : [], [ selectedScene, currentCharacters ]);

  const selectedSceneLocation = useMemo(() => selectedScene
    ? currentLocations.find(l => l.id === selectedScene.locationId)
    : undefined, [ selectedScene, currentLocations ]);

  const completedScenes = useMemo(() => currentScenes.filter(s => s.status === "complete").length, [ currentScenes ]);

  const clientIsLoading = isLoading && !project;

  const currentVideoSrc = useMemo(() => {
    const assets = getAllBestFromAssets(project?.assets);
    return assets['render_video']?.data;
  }, [ project?.assets ]);

  const playbackOffset = useMemo(() => {
    const assets = getAllBestFromAssets(project?.assets);
    if (!assets['render_video']?.data) return 0;
    return activeTimebarScene?.startTime || 0;
  }, [ project, activeTimebarScene ]);


  const handleStartPipeline = useCallback(async () => {
    if (!selectedProject) {
      console.error("Cannot start pipeline: missing project.");
      return;
    }
    if (!initialPrompt) {
      console.error("Cannot start pipeline: missing creative prompt.");
      return;
    }
    try {
      setProjectStatus("analyzing");
      await startPipeline({
        projectId: selectedProject,
        payload: {
          audioGcsUri,
          initialPrompt
        },
      });
    } catch (error) {
      console.error("Failed to start pipeline:", error);
      addMessage({ id: Date.now().toString(), type: "error", message: `Failed to start pipeline: ${(error as Error).message}`, timestamp: new Date() });
      setProjectStatus("error");
    }
  }, [ selectedProject, audioGcsUri, initialPrompt, setProjectStatus, addMessage ]);

  const handleStopPipeline = useCallback(async () => {
    if (!selectedProject) {
      console.error("Cannot stop pipeline: no project selected.");
      return;
    }
    try {
      await stopPipeline({ projectId: selectedProject });
      setProjectStatus("ready");
      addMessage({ id: Date.now().toString(), type: "info", message: "Pipeline stop command issued.", timestamp: new Date() });
    } catch (error) {
      console.error("Failed to stop pipeline:", error);
      addMessage({ id: Date.now().toString(), type: "error", message: `Failed to stop pipeline: ${(error as Error).message}`, timestamp: new Date() });
    }
  }, [ selectedProject, setProjectStatus, addMessage ]);

  const handleResume = async () => {
    if (!selectedProject) return;
    setProjectStatus("analyzing");
    await resumePipeline({ projectId: selectedProject });
  };

  const handleResetDashboard = useCallback(() => {
    resetDashboard();
    clearMessages();
  }, [ resetDashboard, clearMessages ]);

  const handlePause = useCallback(() => setProjectStatus("paused"), [ setProjectStatus ]);
  const handleDismissMessage = useCallback((id: string) => {
    removeMessage(id);
  }, [ removeMessage ]);
  const handleClearMessages = useCallback(() => clearMessages(), [ clearMessages ]);

  const handleRegenerateScene = useCallback(async (promptModification: string) => {
    if (!selectedProject || !selectedScene) return;
    updateSceneClientSide(selectedScene.id, { status: "generating" });

    try {
      await regenerateScene({
        projectId: selectedProject,
        payload: {
          sceneId: selectedScene.id,
          forceRegenerate: true,
          promptModification,
        },
      });

      addMessage({
        id: Date.now().toString(),
        type: "info",
        message: `Regenerating scene ${selectedScene.id}...`,
        timestamp: new Date()
      });
    } catch (error) {
      console.error("Failed to regenerate scene:", error);
      updateSceneClientSide(selectedScene.id, { status: "error" });
      addMessage({
        id: Date.now().toString(),
        type: "error",
        message: `Failed to regenerate scene ${selectedScene.id}: ${(error as Error).message}`,
        timestamp: new Date()
      });
    }
  }, [ selectedProject, selectedScene, updateSceneClientSide, addMessage ]);

  const handleSceneSelect = useCallback((sceneIndex: number) => {
    setSelectedSceneIndex(sceneIndex);
    const sceneToSeek = currentScenes.find(s => s.sceneIndex === sceneIndex);
    if (sceneToSeek) {
      setCurrentPlaybackTime(sceneToSeek.startTime);
    }
  }, [ setSelectedSceneIndex, setCurrentPlaybackTime, currentScenes ]);

  const handlePlayScene = useCallback((sceneIndex: number) => {
    console.log("Play scene ", sceneIndex);
  }, []);

  const handleCharacterSelect = useCallback((characterId: string) => {
    console.log("Select character", characterId);
  }, []);

  const handleLocationSelect = useCallback((locationId: string) => {
    console.log("Select location", locationId);
  }, []);


  // Memoize skeletons and static content
  const sceneSkeletons = useMemo(() => Array.from({ length: 6 }).map((_, i) => (
    <SceneCard key={ i } scene={ {} as Scene } status="pending" isLoading={ true } />
  )), []);

  const characterSkeletons = useMemo(() => Array.from({ length: 4 }).map((_, i) => (
    <CharacterCard key={ i } character={ {} as Character } onSelect={ () => { } } isLoading={ true } />
  )), []);

  const locationSkeletons = useMemo(() => Array.from({ length: 6 }).map((_, i) => (
    <LocationCard key={ i } location={ {} as Location } onSelect={ () => { } } isLoading={ true } />
  )), []);

  const metricSkeletons = useMemo(() => (
    <>
      <MetricCard label="" value="" subValue="" isLoading={ true } />
      <MetricCard label="" value="" subValue="" isLoading={ true } />
      <MetricCard label="" value="" subValue="" isLoading={ true } />
      <MetricCard label="" value="" subValue="" isLoading={ true } />
    </>
  ), []);

  const historySkeletons = useMemo(() => Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={ i } className="h-12 w-full rounded-md" />
  )), []);

  const sceneTabContent = useMemo(() => (
    <TabsContent value="scenes" className="flex-1 overflow-hidden mt-0 p-3">
      <ScrollArea className="h-full">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 p-1 pb-4">
          { clientIsLoading && sceneSkeletons }
          { !clientIsLoading && (currentScenes.length ? (currentScenes.map((scene, index) => (
            <SceneCard
              key={ scene.id }
              scene={ scene }
              status={ scene.status }
              isSelected={ scene.sceneIndex === selectedSceneIndex }
              onSelect={ handleSceneSelect }
              onPlay={ handlePlayScene }
              isLoading={ clientIsLoading }
              priority={ index < 6 }
            />
          ))) :
            <div className="text-xs text-muted-foreground px-4">
              No scenes have been created yet
            </div>
          ) }
        </div>
      </ScrollArea>
    </TabsContent>
  ), [ clientIsLoading, sceneSkeletons, currentScenes, selectedSceneIndex, handleSceneSelect, handlePlayScene ]);

  const characterTabContent = useMemo(() => (
    <TabsContent value="characters" className="flex-1 overflow-hidden mt-0 p-4">
      <ScrollArea className="h-full">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-4">
          { clientIsLoading && characterSkeletons }
          { !clientIsLoading && (currentCharacters.length ? currentCharacters.map((char, index) => (
            <CharacterCard
              key={ char.id }
              character={ char }
              onSelect={ handleCharacterSelect }
              isLoading={ clientIsLoading }
              priority={ index < 8 }
            />
          )) :
            <div className="text-xs text-muted-foreground px-4">
              No characters have been created yet
            </div>
          ) }
        </div>
      </ScrollArea>
    </TabsContent>
  ), [ clientIsLoading, characterSkeletons, currentCharacters, handleCharacterSelect ]);

  const locationTabContent = useMemo(() => (
    <TabsContent value="locations" className="flex-1 overflow-hidden mt-0 p-4">
      <ScrollArea className="h-full">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pb-4">
          { clientIsLoading && locationSkeletons }
          { !clientIsLoading && (currentLocations.length ? currentLocations.map((loc, index) => (
            <LocationCard
              key={ loc.id }
              location={ loc }
              onSelect={ handleLocationSelect }
              isLoading={ clientIsLoading }
              priority={ index < 6 }
            />
          )) : (
            <div className="text-xs text-muted-foreground px-4">
              No locations have been created yet
            </div>
          )) }
        </div>
      </ScrollArea>
    </TabsContent>
  ), [ clientIsLoading, locationSkeletons, currentLocations, handleLocationSelect ]);

  const metricsTabContent = useMemo(() => (
    <TabsContent value="metrics" className="flex-1 overflow-hidden mt-0 p-4">
      <ScrollArea className="h-full">
        <div className="space-y-4 pb-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            { (!currentMetrics || clientIsLoading) ? metricSkeletons : (
              <>
                <MetricCard
                  label="Avg Attempts"
                  value={ currentMetrics?.globalTrend?.averageAttempts.toFixed(1) ?? "—" }
                  subValue="per scene"
                  trend={ currentMetrics?.globalTrend?.attemptTrendSlope && currentMetrics?.globalTrend?.attemptTrendSlope < 0 ? "down" : "neutral" }
                  trendValue={ currentMetrics?.globalTrend ? `${(currentMetrics?.globalTrend.attemptTrendSlope * 100).toFixed(0)}% trend` : undefined }
                  icon={ <RefreshCw className="w-5 h-5" /> }
                />
                <MetricCard
                  label="Quality Score"
                  value={
                    currentMetrics?.sceneMetrics?.[ selectedScene?.id ?? "" ]?.length > 0
                      ? `${Math.round(currentMetrics.sceneMetrics?.[ selectedScene?.id ?? "" ].reduce((a, m) => a + m.finalScore, 0) / currentMetrics.sceneMetrics?.[ selectedScene?.id ?? "" ].length)}%`
                      : "0%"
                  }
                  trend={ currentMetrics?.globalTrend?.qualityTrendSlope && currentMetrics?.globalTrend?.qualityTrendSlope > 0 ? "up" : "neutral" }
                  trendValue={ currentMetrics?.globalTrend ? `+${(currentMetrics?.globalTrend.qualityTrendSlope * 100).toFixed(0)}% improvement` : undefined }
                  icon={ <CheckCircle className="w-5 h-5" /> }
                />
                <MetricCard
                  label="Avg Duration"
                  value={
                    currentMetrics?.sceneMetrics?.length && currentMetrics?.sceneMetrics?.[ selectedScene?.id ?? "" ]?.length > 0
                      ? `${(currentMetrics.sceneMetrics?.[ selectedScene?.id ?? "" ].reduce((a, m) => a + m.duration, 0) / currentMetrics.sceneMetrics?.[ selectedScene?.id ?? "" ].length / 60).toFixed(1)}m`
                      : "0.0m"
                  }
                  subValue="per scene"
                  icon={ <Clock className="w-5 h-5" /> }
                />
                <MetricCard
                  label="Rules Added"
                  value={ currentMetrics?.sceneMetrics?.[ selectedScene?.id ?? "" ]?.filter(m => m.ruleAdded).length ?? 0 }
                  subValue="this session"
                  icon={ <Zap className="w-5 h-5" /> }
                />
              </>
            ) }
          </div>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold">Scene Generation History</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                { (!currentMetrics?.sceneMetrics || clientIsLoading) ? historySkeletons : (
                  currentMetrics.sceneMetrics?.[ selectedScene?.id ?? "" ]?.map((m) => (
                    <div
                      key={ m.sceneId }
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono">#{ m.sceneId }</span>
                        <span className="text-sm text-muted-foreground">
                          { m.attempts } attempt{ m.attempts !== 1 ? "s" : "" }
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{ m.finalScore }%</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          { (m.duration / 60).toFixed(1) }m
                        </span>
                        { m.ruleAdded && (
                          <Zap className="w-3.5 h-3.5 text-chart-4" />
                        ) }
                      </div>
                    </div>
                  ))
                ) }
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </TabsContent>
  ), [ clientIsLoading, metricSkeletons, currentMetrics, historySkeletons ]);

  const logsTabContent = useMemo(() => (
    <TabsContent value="logs" className="flex-1 overflow-hidden mt-0 p-4">
      <Card className="h-full">
        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">Pipeline Messages</CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={ handleClearMessages }
            data-testid="button-clear-logs"
          >
            Clear
          </Button>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <MessageLog
            messages={ messages }
            maxHeight="calc(100vh - 20rem)"
            onDismiss={ handleDismissMessage }
          />
        </CardContent>
      </Card>
    </TabsContent>
  ), [ messages, handleClearMessages, handleDismissMessage ]);

  return (
    <div className="h-screen flex flex-col bg-background">
      <PipelineHeader
        title={ clientIsLoading ? "Loading..." : (currentMetadata?.title || "") }
        handleStart={ handleStartPipeline }
        handleStop={ handleStopPipeline }
        handleResume={ handleResume }
        onPause={ handlePause }
        handleResetDashboard={ handleResetDashboard }
      />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={ 65 } minSize={ 40 }>
            <div className="h-full flex flex-col">
              <div className="p-4 pb-2 border-b shrink-0 space-y-3">
                <Timeline
                  scenes={ currentScenes }
                  selectedSceneIndex={ selectedSceneIndex ?? undefined }
                  totalDuration={ currentMetadata?.duration || 0 }
                  onSceneSelect={ handleSceneSelect }
                  isLoading={ clientIsLoading }
                  isPlaying={ isPlaying }
                  currentTime={ currentPlaybackTime }
                />
                <PlaybackControls
                  scenes={ currentScenes }
                  totalDuration={ currentMetadata?.duration || 0 }
                  videoSrc={ currentVideoSrc }
                  playbackOffset={ playbackOffset }
                  onTimeUpdate={ setCurrentPlaybackTime }
                  isLoading={ clientIsLoading }
                  isPlaying={ isPlaying }
                  setIsPlaying={ setIsPlaying }
                  selectedSceneIndex={ selectedSceneIndex ?? undefined }
                />
              </div>

              <Tabs value={ activeTab } onValueChange={ setActiveTab } className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 pt-3 shrink-0">
                  <TabsList>
                    <TabsTrigger value="scenes" data-testid="tab-scenes">
                      <Film className="w-4 h-4 mr-1.5" />
                      Scenes
                    </TabsTrigger>
                    <TabsTrigger value="characters" data-testid="tab-characters">
                      <Users className="w-4 h-4 mr-1.5" />
                      Characters
                    </TabsTrigger>
                    <TabsTrigger value="locations" data-testid="tab-locations">
                      <MapPin className="w-4 h-4 mr-1.5" />
                      Locations
                    </TabsTrigger>
                    <TabsTrigger value="metrics" data-testid="tab-metrics">
                      <BarChart3 className="w-4 h-4 mr-1.5" />
                      Metrics
                    </TabsTrigger>
                    <TabsTrigger value="logs" data-testid="tab-logs">
                      <MessageSquare className="w-4 h-4 mr-1.5" />
                      Logs
                      { messages.length > 0 && (
                        <span className="ml-1.5 text-[10px] bg-primary text-primary-foreground rounded-full px-1.5">
                          { messages.length }
                        </span>
                      ) }
                    </TabsTrigger>
                    { import.meta.env.MODE === "development" && (
                      <TabsTrigger value="debug" data-testid="tab-debug">
                        <Bug className="w-4 h-4 mr-1.5" />
                        Debug
                      </TabsTrigger>
                    ) }
                  </TabsList>
                </div>

                { sceneTabContent }
                { characterTabContent }
                { locationTabContent }
                { metricsTabContent }
                { logsTabContent }
                { import.meta.env.DEV && (
                  <TabsContent value="debug" className="flex-1 overflow-hidden mt-0 p-4">
                    <DebugStatePanel />
                  </TabsContent>
                ) }
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={ 35 } minSize={ 25 }>
            { selectedScene ? (
              <SceneDetailPanel
                projectId={ selectedProject! }
                scene={ selectedScene }
                status={ selectedScene.status }
                characters={ selectedSceneCharacters }
                location={ selectedSceneLocation }
                isLoading={ clientIsLoading }
                isGenerating={ selectedScene.status === "generating" || selectedScene.status === "evaluating" }
              />
            ) : clientIsLoading ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                <Skeleton className="w-12 h-12 mb-4 rounded-full" />
                <Skeleton className="h-4 w-48" />
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                <Film className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm text-center">Select a scene to view details</p>
              </div>
            ) }
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
