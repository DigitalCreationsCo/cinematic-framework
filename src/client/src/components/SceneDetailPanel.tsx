import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.js";
import { Badge } from "#/components/ui/badge.js";
import { Button } from "#/components/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.js";
import { ScrollArea } from "#/components/ui/scroll-area.js";
import { Play, Pause, RefreshCw, Camera, Sun, Music, Users, MapPin, FileText } from "lucide-react";
import { useRef, useState, useEffect, useCallback, RefObject, memo, useMemo } from "react";
import type { Scene, AssetStatus, Character, Location, QualityEvaluationResult, AssetVersion, AssetRegistry, AssetKey, AssetHistory } from "../../../shared/types/index.js";
import StatusBadge from "./StatusBadge.js";
import QualityEvaluationPanel from "./QualityEvaluationPanel.js";
import FramePreview from "./FramePreview.js";
import { Skeleton } from "#/components/ui/skeleton.js";
import { RegenerateFrameDialog } from "./RegenerateFrameDialog.js";
import { RegenerateSceneDialog } from "./RegenerateSceneDialog.js";
import { AssetHistoryPicker } from "./AssetHistoryPicker.js";
import { regenerateFrame, updateSceneAsset, regenerateScene, getSceneAssets } from "#/lib/api.js";
import { useToast } from "#/hooks/use-toast.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.js";
import { Trash2, History } from "lucide-react";
import { useStore } from "#/lib/store.js";
import { getAllBestFromAssets } from "../../../shared/utils/assets-utils.js";

interface SceneDetailPanelProps {
  scene: Scene;
  status: AssetStatus;
  characters?: Character[];
  location?: Location;
  isGenerating: boolean;
  isLoading?: boolean;
  projectId: string;
}

const SceneDetailPanel = memo(function SceneDetailPanel({
  scene,
  status,
  characters = [],
  location,
  isGenerating,
  isLoading = false,
  projectId,
}: SceneDetailPanelProps) {
  const { toast } = useToast();
  const { updateSceneClientSide, addIgnoreAssetUrl, removeIgnoreAssetUrl } = useStore();
  const [ dialogOpen, setDialogOpen ] = useState(false);
  const [ regenerateSceneDialogOpen, setRegenerateSceneDialogOpen ] = useState(false);
  const [ historyPickerOpen, setHistoryPickerOpen ] = useState(false);
  const [ pickerType, setPickerType ] = useState<AssetKey>("scene_start_frame");
  const [ frameToRegenerate, setFrameToRegenerate ] = useState<"start" | "end" | null>(null);
  const [ isGeneratingFrame, setIsGeneratingFrame ] = useState(false);
  const [ assets, setAssets ] = useState<Partial<Record<AssetKey, AssetVersion | undefined>>>({});

  const hasVideo = !!assets[ 'scene_video' ]?.data;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ isLocalPlaying, setIsLocalPlaying ] = useState(false);

  useEffect(() => {
    if (status === "complete") {
      // setIsLoading(true);
      // setError(null);
      getSceneAssets(projectId, scene.id)
        .then((data) => {
          setAssets(getAllBestFromAssets(data));
        })
        .catch((err) => {
          console.error("Failed to load assets:", err);
          // setError("Failed to load history.");
        });
      // .finally(() => setIsLoading(false));
    }
  }, [ projectId, status, scene, scene.assets ]);

  // Ensure video loads/reloads if scene changes (and thus src changes)
  useEffect(() => {
    if (videoRef?.current) {
      videoRef.current.load();
      setIsLocalPlaying(false);
    }
  }, [ assets[ 'scene_video' ] ]);

  const handleLocalPlay = useCallback(() => {
    if (videoRef?.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(err => console.error("Error playing scene video:", err));
      } else {
        videoRef.current.pause();
      }
    }
  }, []);

  const handleRegenerateClick = (frameType: "start" | "end") => {
    setFrameToRegenerate(frameType);
    setDialogOpen(true);
  };

  const handleDeleteAsset = async (assetKey: Extract<AssetKey, "scene_video" | "scene_start_frame" | "scene_end_frame">, current: number) => {
    const previousScene = { ...scene };
    const urlToIgnore = assets[ assetKey ]?.data || null;

    if (urlToIgnore) {
      addIgnoreAssetUrl(urlToIgnore);
    }

    // Optimistic update
    if (scene.assets[ assetKey ]) {
      scene.assets[ assetKey ].best = 0;
      updateSceneClientSide(scene.id, scene);
    }

    try {
      await updateSceneAsset({
        projectId,
        payload: {
          scene: scene,
          assetKey: assetKey,
          version: null,
        },
      });
      toast({
        title: "Asset Deleted",
        description: `The ${assetKey} has been removed from the scene.`,
        duration: 500,
      });
    } catch (error) {
      // Rollback
      if (urlToIgnore) {
        removeIgnoreAssetUrl(urlToIgnore);
      }
      updateSceneClientSide(scene.id, previousScene);
      toast({
        title: "Error",
        description: `Failed to delete asset: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    }
  };

  const handleHistoryClick = (assetKey: Extract<AssetKey, "scene_video" | "scene_start_frame" | "scene_end_frame">) => {
    setPickerType(assetKey);
    setHistoryPickerOpen(true);
  };

  const handleSelectAsset = async (asset: AssetVersion) => {
    const previousScene = { ...scene };

    removeIgnoreAssetUrl(asset.data);

    // Optimistic update
    if (scene.assets[ pickerType ]) {
      scene.assets[ pickerType ].best = asset.version;
      updateSceneClientSide(scene.id, scene);
    }

    try {
      await updateSceneAsset({
        projectId,
        payload: {
          scene: scene,
          assetKey: pickerType,
          version: asset.version,
        },
      });
      toast({
        title: "Asset Restored",
        description: `Restored attempt #${asset.version} for ${pickerType}.`,
        duration: 500,
      });
    } catch (error) {
      // Rollback
      updateSceneClientSide(scene.id, previousScene);
      toast({
        title: "Error",
        description: `Failed to restore asset: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    }
  };

  const handleRegenerateSubmit = async (newPrompt: string, originalPrompt: string) => {
    if (!frameToRegenerate) return;
    setIsGeneratingFrame(true);
    try {
      await regenerateFrame({
        projectId: projectId,
        payload: {
          sceneId: scene.id,
          frameType: frameToRegenerate,
          promptModification: newPrompt || originalPrompt,
        }
      });
      toast({
        title: "Frame Regeneration Started",
        description: `The ${frameToRegenerate} frame for scene ${scene.id} is being regenerated.`,
        duration: 500,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to start frame regeneration: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    } finally {
      setDialogOpen(false);
      setFrameToRegenerate(null);
      setIsGeneratingFrame(false);
    }
  };

  const handleSceneRegenerateSubmit = async (promptModification: string) => {
    updateSceneClientSide(scene.id, { status: "generating" });
    try {
      await regenerateScene({
        projectId: projectId,
        payload: {
          sceneId: scene.id,
          forceRegenerate: true,
          promptModification,
        },
      });

      toast({
        title: "Scene Regeneration Started",
        description: `Regenerating scene ${scene.id}...`,
        duration: 500,
      });
    } catch (error) {
      console.error("Failed to regenerate scene:", error);
      updateSceneClientSide(scene.id, { status: "error" });
      toast({
        title: "Error",
        description: `Failed to regenerate scene ${scene.id}: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    }
  };

  const toggleDialog = () => setDialogOpen(!dialogOpen);

  return (
    <>
      <RegenerateFrameDialog
        scene={ scene }
        frameToRegenerate={ frameToRegenerate }
        isOpen={ dialogOpen }
        onOpenChange={ toggleDialog }
        onSubmit={ handleRegenerateSubmit }
      />
      <RegenerateSceneDialog
        scene={ scene }
        isOpen={ regenerateSceneDialogOpen }
        onOpenChange={ setRegenerateSceneDialogOpen }
        onSubmit={ handleSceneRegenerateSubmit }
      />
      <AssetHistoryPicker
        sceneId={ scene.id }
        assetType={ pickerType }
        projectId={ projectId }
        isOpen={ historyPickerOpen }
        onOpenChange={ setHistoryPickerOpen }
        onSelect={ handleSelectAsset }
        currentUrl={
          assets[ pickerType ]?.data
        }
      />
      <div className="h-full flex flex-col" data-testid={ `panel-scene-detail-${scene.id}` }>
        <div className="p-4 border-b flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            { isLoading ? (
              <Skeleton className="h-5 w-12 rounded-full" />
            ) : (
              <Badge variant="outline" className="font-mono text-sm shrink-0">#{ scene.id }</Badge>
            ) }
            { isLoading ? (
              <Skeleton className="h-6 w-1/2" />
            ) : (
              <h2 className="text-lg font-semibold truncate">{ scene.shotType }</h2>
            ) }
            { isLoading ? <Skeleton className="h-5 w-16" /> : <StatusBadge status={ status } /> }
          </div>
          <div className="flex items-center gap-2 shrink-0">
            { isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : hasVideo && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" onClick={ handleLocalPlay } data-testid="button-play-video">
                    { isLocalPlaying ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" /> }
                    { isLocalPlaying ? "Pause" : "Play" }
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  { isLocalPlaying ? "Pause" : "Play Scene" }
                </TooltipContent>
              </Tooltip>
            ) }
            { isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={ () => setRegenerateSceneDialogOpen(true) } data-testid="button-regenerate" disabled={ isGenerating }>
                    { isGenerating ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-1" />
                        Regenerate Scene
                      </>
                    ) }
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Regenerate Scene</TooltipContent>
              </Tooltip>
            ) }
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FramePreview
                title="Start Frame"
                imageUrl={ assets[ 'scene_start_frame' ]?.data }
                alt="Start frame"
                isLoading={ isLoading }
                onRegenerate={ () => handleRegenerateClick("start") }
                onDelete={ () => handleDeleteAsset("scene_start_frame", assets[ "scene_start_frame" ]?.version || 0) }
                onHistory={ () => handleHistoryClick("scene_start_frame") }
                isGenerating={ isGeneratingFrame }
                priority={ true }
              />
              <FramePreview
                title="End Frame"
                imageUrl={ assets[ "scene_end_frame" ]?.data }
                alt="End frame"
                isLoading={ isLoading }
                onRegenerate={ () => handleRegenerateClick("end") }
                onDelete={ () => handleDeleteAsset("scene_end_frame", assets[ "scene_end_frame" ]?.version || 0) }
                onHistory={ () => handleHistoryClick("scene_end_frame") }
                isGenerating={ isGeneratingFrame }
                priority={ true }
              />
            </div>

            { isLoading ? (
              <Card>
                <Skeleton className="w-full aspect-[16/8] bg-muted rounded-md" />
              </Card>
            ) : (
              <Card>
                <CardContent className="p-3 relative">
                  { isGenerating && (
                    <div className="absolute inset-3 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10 rounded-md">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{ scene.progressMessage || "Generating scene..." }</span>
                      </div>
                    </div>
                  ) }
                  <div
                    className="aspect-[16/8] bg-muted rounded-md overflow-hidden"
                  // This container's existence is now independent of hasVideo,
                  // ensuring a consistent layout space for the video/placeholder/overlay.
                  >
                    { hasVideo && (
                      <video
                        ref={ videoRef }
                        key={ assets[ 'scene_video' ]?.data }
                        src={ assets[ 'scene_video' ]?.data }
                        preload="auto"
                        playsInline
                        className={ `w-full h-full object-cover` }
                        controls={ false }
                        onPlay={ () => setIsLocalPlaying(true) }
                        onPause={ () => setIsLocalPlaying(false) }
                        onEnded={ () => setIsLocalPlaying(false) }
                      />
                    ) }
                    {/* Show placeholder only when there's no video to display and we are not generating */ }
                    { !hasVideo && !isGenerating && (
                      <div className="w-full h-full flex items-center justify-center">
                        <Camera className="w-8 h-8 text-muted-foreground" />
                      </div>
                    ) }
                  </div>
                  {/* Video Controls Overlay */ }
                  <div className="absolute top-3 right-3 flex gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background/80 backdrop-blur-sm" onClick={ () => handleHistoryClick("scene_video") }>
                          <History className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View History</TooltipContent>
                    </Tooltip>
                    { (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" disabled={ !hasVideo } className="h-8 w-8 bg-background/50 hover:bg-background/80 hover:text-destructive backdrop-blur-sm" onClick={ (e) => {
                            e.stopPropagation();
                            if (confirm("Are you sure you want to delete this video?")) {
                              handleDeleteAsset("scene_video", assets[ 'scene_video' ]?.version || 0);
                            }
                          } }>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete Video</TooltipContent>
                      </Tooltip>
                    ) }
                  </div>
                </CardContent>
              </Card>
            ) }

            <Tabs defaultValue="details" className="w-full">
              <TabsList className="w-full grid grid-cols-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>View scene technical details</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="quality" data-testid="tab-quality">Quality</TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>View quality evaluation metrics</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="prompt" data-testid="tab-prompt">Prompt</TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>View generation prompt</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="continuity" data-testid="tab-continuity">Continuity</TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>View continuity analysis</TooltipContent>
                </Tooltip>
              </TabsList>

              <TabsContent value="details" className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Camera className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Camera:</span>
                      <span className="font-medium">{ isLoading ? <Skeleton className="h-4 w-20" /> : scene.cameraMovement }</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Sun className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Lighting:</span>
                      <span className="font-medium">{ isLoading ? <Skeleton className="h-4 w-20" /> : scene.lighting.quality.hardness }</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Music className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Audio Sync:</span>
                      <span className="font-medium">{ isLoading ? <Skeleton className="h-4 w-20" /> : scene.audioSync }</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Duration:</span>
                      <span className="font-mono ml-2">{ isLoading ? <Skeleton className="h-4 w-12 inline-block" /> : scene.duration }s</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Time:</span>
                      <span className="font-mono ml-2">{ isLoading ? <Skeleton className="h-4 w-32 inline-block" /> : `${scene.startTime.toFixed(1)}s - ${scene.endTime.toFixed(1)}s` }</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Transition:</span>
                      <span className="ml-2">{ isLoading ? <Skeleton className="h-4 w-24 inline-block" /> : scene.transitionType }</span>
                    </div>
                  </div>
                </div>

                <Card>
                  <CardHeader className="p-3 pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Mood</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    { isLoading ? <Skeleton className="h-10 w-full" /> : <p className="text-sm">{ scene.mood }</p> }
                  </CardContent>
                </Card>

                { scene.lyrics && (
                  <Card>
                    <CardHeader className="p-3 pb-2">
                      <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Lyrics</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      { isLoading ? <Skeleton className="h-8 w-full" /> : <p className="text-sm italic">"{ scene.lyrics }"</p> }
                    </CardContent>
                  </Card>
                ) }

                { location && (
                  <Card>
                    <CardHeader className="p-3 pb-2">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-medium">{ isLoading ? <Skeleton className="h-4 w-32" /> : location.name }</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      { isLoading ? <Skeleton className="h-4 w-full" /> : <p className="text-xs text-muted-foreground">{ location.assets[ 'location_description' ]?.versions[ location.assets[ 'location_description' ]?.best ].data }</p> }
                    </CardContent>
                  </Card>
                ) }

                { characters.length > 0 && (
                  <Card>
                    <CardHeader className="p-3 pb-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-medium">Characters</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      { isLoading ? (
                        <div className="flex flex-wrap gap-2">
                          { Array.from({ length: 3 }).map((_, i) => <Skeleton key={ i } className="h-6 w-16 rounded-full" />) }
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          { characters.map((char) => (
                            <Badge key={ char.id } variant="secondary">{ char.name }</Badge>
                          )) }
                        </div>
                      ) }
                    </CardContent>
                  </Card>
                ) }
              </TabsContent>

              <TabsContent value="quality" className="mt-4">
                { isLoading ? (
                  <Card>
                    <CardHeader className="p-3 pb-2">
                      <Skeleton className="h-4 w-40" />
                    </CardHeader>
                    <CardContent className="p-6 text-center text-muted-foreground">
                      <Skeleton className="h-8 w-full mb-2" />
                      <Skeleton className="h-4 w-2/3 mx-auto" />
                    </CardContent>
                  </Card>
                ) : assets[ 'scene_video' ]?.metadata.evaluation ? (
                  <QualityEvaluationPanel evaluation={ assets[ 'scene_video' ]?.metadata.evaluation } sceneId={ scene.id } />
                ) : (
                  <Card>
                    <CardContent className="p-6 text-center text-muted-foreground">
                      No quality evaluation available yet
                    </CardContent>
                  </Card>
                ) }
              </TabsContent>

              <TabsContent value="prompt" className="mt-4">
                <Card>
                  <CardHeader className="p-3 pb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <CardTitle className="text-sm font-medium">Prompt</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    { isLoading ? (
                      <Skeleton className="h-24 w-full" />
                    ) : assets[ 'scene_prompt' ]?.data ? (
                      <p className="text-sm font-mono whitespace-pre-wrap bg-muted p-3 rounded-md">
                        { assets[ 'scene_prompt' ].data }
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">No enhanced prompt generated yet</p>
                    ) }
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="continuity" className="mt-4 space-y-4">
                <Card>
                  <CardHeader className="p-3 pb-2">
                    <CardTitle className="text-sm font-medium">Continuity Notes</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    { isLoading ? (
                      <ul className="space-y-2">
                        { Array.from({ length: 3 }).map((_, i) => <li key={ i } className="text-sm text-muted-foreground flex items-start gap-2"><span className="text-muted-foreground/50">•</span><Skeleton className="h-3 w-full" /></li>) }
                      </ul>
                    ) : scene.continuityNotes.length > 0 ? (
                      <ul className="space-y-1">
                        { scene.continuityNotes.map((note, idx) => (
                          <li key={ idx } className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="text-muted-foreground/50">•</span>
                            { note }
                          </li>
                        )) }
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No continuity notes</p>
                    ) }
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="p-3 pb-2">
                    <CardTitle className="text-sm font-medium">Audio Details</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0 space-y-2">
                    { isLoading ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Type:</span><Skeleton className="h-5 w-16" /></div>
                        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Intensity:</span><Skeleton className="h-5 w-16" /></div>
                        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Tempo:</span><Skeleton className="h-5 w-16" /></div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Type:</span>
                          <Badge variant="outline">{ scene.type }</Badge>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Intensity:</span>
                          <Badge variant="outline">{ scene.intensity }</Badge>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Tempo:</span>
                          <Badge variant="outline">{ scene.tempo }</Badge>
                        </div>
                      </>
                    ) }
                    { isLoading ? (
                      <div className="pt-2 border-t"><span className="text-xs text-muted-foreground">Music Change:</span><Skeleton className="h-4 w-48 mt-1" /></div>
                    ) : (
                      scene.musicChange && (
                        <div className="pt-2 border-t">
                          <span className="text-xs text-muted-foreground">Music Change:</span>
                          <p className="text-sm mt-1">{ scene.musicChange }</p>
                        </div>
                      )
                    ) }
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </div>
    </>
  );
});

export default SceneDetailPanel;
