import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@/components/ui/resizable";
import {
  Film,
  Users,
  MapPin,
  BarChart3,
  MessageSquare,
  Zap,
  Clock,
  RefreshCw,
  CheckCircle
} from "lucide-react";
import type {
  Scene,
  Character,
  Location,
  SceneStatus,
  PipelineMessage,
  WorkflowMetrics,
  Storyboard
} from "@shared/pipeline-types";
import PipelineHeader from "@/components/PipelineHeader";
import SceneCard from "@/components/SceneCard";
import SceneDetailPanel from "@/components/SceneDetailPanel";
import Timeline from "@/components/Timeline";
import PlaybackControls from "@/components/PlaybackControls";
import MessageLog from "@/components/MessageLog";
import CharacterCard from "@/components/CharacterCard";
import LocationCard from "@/components/LocationCard";
import MetricCard from "@/components/MetricCard";
import { usePipelineEvents } from "@/hooks/use-pipeline-events";
import { useStore } from "@/lib/store";
import { startPipeline, stopPipeline } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const {
    isDark,
    pipelineStatus,
    selectedSceneId,
    activeTab,
    audioUrl,
    creativePrompt,
    setIsDark,
    setPipelineStatus,
    setSelectedSceneId,
    setActiveTab,
    currentPlaybackTime,
    setCurrentPlaybackTime,
    resetDashboard,
    selectedProject,
    isPlaying,
    setIsPlaying,
  } = useStore();

  const { connected: sseConnected, pipelineState, isLoading, error } = usePipelineEvents({ projectId: selectedProject || null });
  const mainVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (pipelineState) {
      setPipelineStatus(pipelineState.currentSceneIndex < (pipelineState.storyboardState?.scenes.length || 0) ? "generating" : "complete");
    }
  }, [ pipelineState, setPipelineStatus ]);

  const [ messages, setMessages ] = useState<PipelineMessage[]>([]);

  // useEffect(() => {
  //   if (data?.messages) {
  //     setMessages(data.messages);
  //   }
  // }, [ data ]);

  useEffect(() => {
    if (pipelineState?.errors && pipelineState.errors.length > messages.filter(m => m.type === "error").length) {
      const newError = pipelineState.errors[ pipelineState.errors.length - 1 ];
      setMessages(prev => [ { id: Date.now().toString(), type: "error", message: `Pipeline Error: ${newError}`, timestamp: new Date() }, ...prev ]);
    } else if (pipelineState?.storyboardState && pipelineState.currentSceneIndex > 0 && pipelineState.currentSceneIndex > messages.filter(m => m.type === "info" && m.message.includes("Processing Scene")).length) {
      const currentScene = pipelineState.storyboardState.scenes[ pipelineState.currentSceneIndex - 1 ];
      if (currentScene) {
        setMessages(prev => [ {
          id: Date.now().toString(),
          type: "info",
          message: `Processing Scene ${currentScene.id} - ${currentScene.description.substring(0, 50)}...`,
          timestamp: new Date(),
          sceneId: currentScene.id,
        }, ...prev ]);
      }
    } else if (pipelineState?.renderedVideoUrl && !messages.some(m => m.message.includes("Video generation complete"))) {
      setMessages(prev => [ { id: Date.now().toString(), type: "success", message: "Video generation complete!", timestamp: new Date() }, ...prev ]);
    }
  }, [ pipelineState, messages ]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [ isDark ]);

  const currentScenes = useMemo(() => pipelineState?.storyboardState?.scenes || [], [ pipelineState ]);
  const currentCharacters = useMemo(() => pipelineState?.storyboardState?.characters || [], [ pipelineState ]);
  const currentLocations = useMemo(() => pipelineState?.storyboardState?.locations || [], [ pipelineState ]);
  const currentMetadata = useMemo(() => pipelineState?.storyboardState?.metadata, [ pipelineState ]);
  const currentMetrics = useMemo(() => pipelineState?.metrics, [ pipelineState ]);

  const currentSceneStatuses = useMemo(() => pipelineState?.storyboardState?.scenes.reduce<Record<number, SceneStatus>>((acc, scene) => {
    acc[ scene.id ] = scene.generatedVideo ? "complete" : "pending";
    return acc;
  }, {}) || {}, [ pipelineState ]);

  const selectedScene = useMemo(() => currentScenes.find(s => s.id === selectedSceneId), [ currentScenes, selectedSceneId ]);

  const selectedSceneCharacters = useMemo(() => selectedScene
    ? currentCharacters.filter(c => selectedScene.characters.includes(c.id))
    : [], [ selectedScene, currentCharacters ]);

  const selectedSceneLocation = useMemo(() => selectedScene
    ? currentLocations.find(l => l.id === selectedScene.locationId)
    : undefined, [ selectedScene, currentLocations ]);

  const completedScenes = useMemo(() => Object.values(currentSceneStatuses).filter(s => s === "complete").length, [ currentSceneStatuses ]);

  const clientIsLoading = isLoading && !pipelineState;

  const activeScene = useMemo(() => {
    return currentScenes.find(s =>
      currentPlaybackTime >= s.startTime &&
      currentPlaybackTime < s.endTime
    );
  }, [ currentScenes, currentPlaybackTime ]);

  const currentVideoSrc = useMemo(() => {
    if (pipelineState?.renderedVideoUrl) return pipelineState.renderedVideoUrl;
    return activeScene?.generatedVideo?.publicUri;
  }, [ pipelineState, activeScene ]);

  const playbackOffset = useMemo(() => {
    if (pipelineState?.renderedVideoUrl) return 0;
    return activeScene?.startTime || 0;
  }, [ pipelineState, activeScene ]);


  const handleStartPipeline = useCallback(async () => {
    if (!selectedProject || !audioUrl || !creativePrompt) {
      console.error("Cannot start pipeline: missing project, audio, or creative prompt.");
      return;
    }
    try {
      setPipelineStatus("analyzing");
      await startPipeline({ projectId: selectedProject, audioUrl, creativePrompt });
    } catch (error) {
      console.error("Failed to start pipeline:", error);
      setMessages(prev => [ { id: Date.now().toString(), type: "error", message: `Failed to start pipeline: ${(error as Error).message}`, timestamp: new Date() }, ...prev ]);
      setPipelineStatus("error");
    }
  }, [ selectedProject, audioUrl, creativePrompt, setPipelineStatus ]);

  const handleStopPipeline = useCallback(async () => {
    if (!selectedProject) {
      console.error("Cannot stop pipeline: no project selected.");
      return;
    }
    try {
      await stopPipeline({ projectId: selectedProject });
      setPipelineStatus("idle");
      setMessages(prev => [ { id: Date.now().toString(), type: "info", message: "Pipeline stop command issued.", timestamp: new Date() }, ...prev ]);
    } catch (error) {
      console.error("Failed to stop pipeline:", error);
      setMessages(prev => [ { id: Date.now().toString(), type: "error", message: `Failed to stop pipeline: ${(error as Error).message}`, timestamp: new Date() }, ...prev ]);
    }
  }, [ selectedProject, setPipelineStatus ]);

  const handleResetDashboard = useCallback(() => {
    resetDashboard();
    setMessages([]);
  }, [ resetDashboard ]);

  const handleToggleTheme = useCallback(() => setIsDark(!isDark), [ isDark, setIsDark ]);
  const handlePause = useCallback(() => setPipelineStatus("idle"), [ setPipelineStatus ]);
  const handleDismissMessage = useCallback((id: string) => {
    setMessages((prev: PipelineMessage[]) => prev.filter(m => m.id !== id));
  }, []);
  const handleClearMessages = useCallback(() => setMessages([]), []);
  const handleRegenerateScene = useCallback(() => {
    console.log("Regenerate scene", selectedSceneId);
  }, [ selectedSceneId ]);

  const handleSceneSelect = useCallback((sceneId: number) => {
    setSelectedSceneId(sceneId);
    const sceneToSeek = currentScenes.find(s => s.id === sceneId);
    if (sceneToSeek) {
      setCurrentPlaybackTime(sceneToSeek.startTime);
    }
  }, [ setSelectedSceneId, setCurrentPlaybackTime, currentScenes ]);

  const handlePlayScene = useCallback((sceneId: number) => {
    console.log("Play scene", sceneId);
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
    <TabsContent value="scenes" className="flex-1 overflow-hidden mt-0 p-4">
      <ScrollArea className="h-full">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pb-4">
          { clientIsLoading && sceneSkeletons }
          { !clientIsLoading && currentScenes.map((scene) => (
            <SceneCard
              key={ scene.id }
              scene={ scene }
              status={ currentSceneStatuses[ scene.id ] || "pending" }
              isSelected={ scene.id === selectedSceneId }
              onSelect={ handleSceneSelect }
              onPlay={ handlePlayScene }
              isLoading={ clientIsLoading }
            />
          )) }
        </div>
      </ScrollArea>
    </TabsContent>
  ), [ clientIsLoading, sceneSkeletons, currentScenes, currentSceneStatuses, selectedSceneId, handleSceneSelect, handlePlayScene ]);

  const characterTabContent = useMemo(() => (
    <TabsContent value="characters" className="flex-1 overflow-hidden mt-0 p-4">
      <ScrollArea className="h-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
          { clientIsLoading && characterSkeletons }
          { !clientIsLoading && currentCharacters.map((char) => (
            <CharacterCard
              key={ char.id }
              character={ char }
              onSelect={ handleCharacterSelect }
              isLoading={ clientIsLoading }
            />
          )) }
        </div>
      </ScrollArea>
    </TabsContent>
  ), [ clientIsLoading, characterSkeletons, currentCharacters, handleCharacterSelect ]);

  const locationTabContent = useMemo(() => (
    <TabsContent value="locations" className="flex-1 overflow-hidden mt-0 p-4">
      <ScrollArea className="h-full">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pb-4">
          { clientIsLoading && locationSkeletons }
          { !clientIsLoading && currentLocations.map((loc) => (
            <LocationCard
              key={ loc.id }
              location={ loc }
              onSelect={ handleLocationSelect }
              isLoading={ clientIsLoading }
            />
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
                    currentMetrics?.sceneMetrics?.length && currentMetrics?.sceneMetrics?.length > 0
                      ? `${Math.round(currentMetrics.sceneMetrics.reduce((a, m) => a + m.finalScore, 0) / currentMetrics.sceneMetrics.length)}%`
                      : "0%"
                  }
                  trend={ currentMetrics?.globalTrend?.qualityTrendSlope && currentMetrics?.globalTrend?.qualityTrendSlope > 0 ? "up" : "neutral" }
                  trendValue={ currentMetrics?.globalTrend ? `+${(currentMetrics?.globalTrend.qualityTrendSlope * 100).toFixed(0)}% improvement` : undefined }
                  icon={ <CheckCircle className="w-5 h-5" /> }
                />
                <MetricCard
                  label="Avg Duration"
                  value={
                    currentMetrics?.sceneMetrics?.length && currentMetrics?.sceneMetrics?.length > 0
                      ? `${(currentMetrics.sceneMetrics.reduce((a, m) => a + m.duration, 0) / currentMetrics.sceneMetrics.length / 60).toFixed(1)}m`
                      : "0.0m"
                  }
                  subValue="per scene"
                  icon={ <Clock className="w-5 h-5" /> }
                />
                <MetricCard
                  label="Rules Added"
                  value={ currentMetrics?.sceneMetrics?.filter(m => m.ruleAdded).length ?? 0 }
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
                  currentMetrics.sceneMetrics.map((m) => (
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
        title={ currentMetadata?.title || "Loading..." }
        status={ pipelineStatus }
        connected={ sseConnected }
        progress={ { current: completedScenes, total: currentScenes.length } }
        isDark={ isDark }
        onToggleTheme={ handleToggleTheme }
        onStart={ handleStartPipeline }
        onPause={ handlePause }
        onStop={ handleStopPipeline }
        onReset={ handleResetDashboard }
      />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={ 65 } minSize={ 40 }>
            <div className="h-full flex flex-col">
              <div className="p-4 pb-2 border-b shrink-0 space-y-3">
                <Timeline
                  scenes={ currentScenes }
                  sceneStatuses={ currentSceneStatuses }
                  selectedSceneId={ selectedSceneId ?? undefined }
                  totalDuration={ currentMetadata?.duration || 0 }
                  onSceneSelect={ handleSceneSelect }
                  isLoading={ clientIsLoading }
                  isPlaying={ isPlaying }
                />
                <PlaybackControls
                  scenes={ currentScenes }
                  totalDuration={ currentMetadata?.duration || 0 }
                  audioUrl={ audioUrl }
                  mainVideoRef={ mainVideoRef }
                  playbackOffset={ playbackOffset }
                  onSeekSceneChange={ setSelectedSceneId }
                  onTimeUpdate={ setCurrentPlaybackTime }
                  isLoading={ clientIsLoading }
                  isPlaying={ isPlaying }
                  setIsPlaying={ setIsPlaying }
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
                  </TabsList>
                </div>

                { sceneTabContent }
                { characterTabContent }
                { locationTabContent }
                { metricsTabContent }
                { logsTabContent }
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={ 35 } minSize={ 25 }>
            { selectedScene ? (
              <SceneDetailPanel
                scene={ selectedScene }
                status={ currentSceneStatuses[ selectedScene.id ] || "pending" }
                characters={ selectedSceneCharacters }
                location={ selectedSceneLocation }
                onRegenerate={ handleRegenerateScene }
                isLoading={ clientIsLoading }
                mainVideoRef={ mainVideoRef }
                mainVideoSrc={ currentVideoSrc }
                currentPlaybackTime={ currentPlaybackTime }
                isGlobalPlaying={ isPlaying }
                onGlobalPause={ () => setIsPlaying(false) }
                onMainVideoEnded={ () => {
                  // Only auto-stop from video event if we're playing the final render
                  // Otherwise PlaybackControls manages the timeline
                  if (pipelineState?.renderedVideoUrl) {
                    setIsPlaying(false);
                  }
                } }
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
