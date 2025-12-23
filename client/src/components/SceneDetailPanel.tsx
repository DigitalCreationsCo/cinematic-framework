import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Pause, RefreshCw, Camera, Sun, Music, Users, MapPin, FileText } from "lucide-react";
import { useRef, useState, useEffect, useCallback, RefObject, memo, useMemo } from "react";
import type { Scene, SceneStatus, Character, Location } from "@shared/pipeline-types";
import StatusBadge from "./StatusBadge";
import QualityEvaluationPanel from "./QualityEvaluationPanel";
import FramePreview from "./FramePreview";
import { Skeleton } from "@/components/ui/skeleton";
import { RegenerateFrameDialog } from "./RegenerateFrameDialog";
import { regenerateFrame } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface SceneDetailPanelProps {
  scene: Scene;
  status: SceneStatus;
  characters?: Character[];
  location?: Location;
  onRegenerate?: (e: React.MouseEvent) => void;
  isGenerating: boolean;
  isLoading?: boolean;
  projectId: string;
}

const SceneDetailPanel = memo(function SceneDetailPanel({
  scene,
  status,
  characters = [],
  location,
  onRegenerate,
  isGenerating,
  isLoading = false,
  projectId,
}: SceneDetailPanelProps) {
  const { toast } = useToast();
  const [ dialogOpen, setDialogOpen ] = useState(false);
  const [ frameToRegenerate, setFrameToRegenerate ] = useState<"start" | "end" | null>(null);
  const [ isGeneratingFrame, setIsGeneratingFrame ] = useState(false);

  const hasVideo = !!scene.generatedVideo?.publicUri;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ isLocalPlaying, setIsLocalPlaying ] = useState(false);

  // Ensure video loads/reloads if scene changes (and thus src changes)
  useEffect(() => {
    if (videoRef?.current) {
      videoRef.current.load();
      setIsLocalPlaying(false);
    }
  }, [ scene.generatedVideo?.publicUri ]);

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

  const handleRegenerateSubmit = async (newPrompt: string, originalPrompt: string) => {
    if (!frameToRegenerate) return;
    setIsGeneratingFrame(true);
    try {
      await regenerateFrame({
        projectId: projectId,
        sceneId: scene.id,
        frameType: frameToRegenerate,
        promptModification: newPrompt || originalPrompt,
      });
      toast({
        title: "Frame Regeneration Started",
        description: `The ${frameToRegenerate} frame for scene ${scene.id} is being regenerated.`,
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

  const toggleDialog = () => setDialogOpen(!dialogOpen);

  return (
    <>
      <RegenerateFrameDialog
        isOpen={ dialogOpen }
        onOpenChange={ toggleDialog }
        onSubmit={ handleRegenerateSubmit }
        originalPrompt={
          frameToRegenerate === "start"
            ? scene.startFramePrompt
            : scene.endFramePrompt
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
              <Button size="sm" onClick={ handleLocalPlay } data-testid="button-play-video">
                { isLocalPlaying ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" /> }
                { isLocalPlaying ? "Pause" : "Play" }
              </Button>
            ) }
            { isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
                <Button size="sm" variant="outline" onClick={ (e) => { confirm('Are you sure you want to regenerate this scene? You can\'t undo this.') && onRegenerate?.(e); } } data-testid="button-regenerate" disabled={ isGenerating }>
                { isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Regenerate
                  </>
                ) }
              </Button>
            ) }
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FramePreview
                title="Start Frame"
                imageUrl={ scene.startFrame?.publicUri }
                alt="Start frame"
                isLoading={ isLoading }
                onRegenerate={ () => handleRegenerateClick("start") }
                isGenerating={ isGeneratingFrame }
              />
              <FramePreview
                title="End Frame"
                imageUrl={ scene.endFrame?.publicUri }
                alt="End frame"
                isLoading={ isLoading }
                onRegenerate={ () => handleRegenerateClick("end") }
                isGenerating={ isGeneratingFrame }
              />
            </div>

            { isLoading ? (
              <Card>
                <Skeleton className="w-full aspect-video bg-muted rounded-md" />
              </Card>
            ) : (
              <Card>
                <CardContent className="p-3 relative">
                  { isGenerating && (
                    <div className="absolute inset-3 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10 rounded-md">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{scene.progressMessage || "Generating scene..."}</span>
                      </div>
                    </div>
                  ) }
                  <div
                    className="aspect-video bg-muted rounded-md"
                  // This container's existence is now independent of hasVideo,
                  // ensuring a consistent layout space for the video/placeholder/overlay.
                  >
                    { hasVideo && (
                      <video
                        ref={ videoRef }
                        key={ scene.generatedVideo?.publicUri } // Re-mounts the video player when src changes
                        src={ scene.generatedVideo?.publicUri }
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
                </CardContent>
              </Card>
            ) }

            <Tabs defaultValue="details" className="w-full">
              <TabsList className="w-full grid grid-cols-4">
                <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
                <TabsTrigger value="quality" data-testid="tab-quality">Quality</TabsTrigger>
                <TabsTrigger value="prompt" data-testid="tab-prompt">Prompt</TabsTrigger>
                <TabsTrigger value="continuity" data-testid="tab-continuity">Continuity</TabsTrigger>
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
                      <span className="font-medium">{ isLoading ? <Skeleton className="h-4 w-20" /> : scene.lighting.quality }</span>
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
                      { isLoading ? <Skeleton className="h-4 w-full" /> : <p className="text-xs text-muted-foreground">{ location.description }</p> }
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
                ) : scene.evaluation ? (
                  <QualityEvaluationPanel evaluation={ scene.evaluation } sceneId={ scene.id } />
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
                      <CardTitle className="text-sm font-medium">Enhanced Prompt</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    { isLoading ? (
                      <Skeleton className="h-24 w-full" />
                    ) : scene.enhancedPrompt ? (
                      <p className="text-sm font-mono whitespace-pre-wrap bg-muted p-3 rounded-md">
                        { scene.enhancedPrompt }
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
