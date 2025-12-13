import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, RefreshCw, Camera, Sun, Music, Users, MapPin, FileText } from "lucide-react";
import { useRef, useEffect, useCallback, RefObject } from "react";
import type { Scene, SceneStatus, Character, Location } from "@shared/pipeline-types";
import StatusBadge from "./StatusBadge";
import QualityEvaluationPanel from "./QualityEvaluationPanel";
import FramePreview from "./FramePreview";
import { Skeleton } from "@/components/ui/skeleton"; // Import Skeleton

interface SceneDetailPanelProps {
  scene: Scene;
  status: SceneStatus;
  characters?: Character[];
  location?: Location;
  currentTime: number;
  isPlaying: boolean;
  audioUrl?: string;
  onRegenerate?: () => void;
  onPlayMainVideo?: () => void; // Renamed from onPlayVideo to match PlaybackControls
  mainVideoRef?: RefObject<HTMLVideoElement>;
  isLoading?: boolean;
}

export default function SceneDetailPanel({
  scene,
  status,
  characters = [],
  location,
  currentTime,
  isPlaying,
  audioUrl,
  onRegenerate,
  onPlayMainVideo,
  mainVideoRef,
  isLoading = false
}: SceneDetailPanelProps) {
  const hasVideo = !!scene.generatedVideo?.publicUri;

  // Effect to sync time and handle intrinsic video audio muting based on global state/audioUrl
  useEffect(() => {
    if (mainVideoRef?.current) {
      // 1. Time Synchronization
      mainVideoRef.current.currentTime = currentTime;

      // 2. Audio Muting logic: if user audio exists, mute local video audio.
      if (audioUrl) {
        mainVideoRef.current.muted = true;
      } else {
        mainVideoRef.current.muted = false;
      }
    }
  }, [ currentTime, audioUrl, mainVideoRef ]);

  // Effect to handle play/pause based on global state
  useEffect(() => {
    if (mainVideoRef?.current) {
      if (isPlaying) {
        mainVideoRef.current.play().catch(err => console.error("Error playing main video:", err));
      } else {
        mainVideoRef.current.pause();
      }
    }
  }, [ isPlaying, mainVideoRef ]);

  // Ensure video loads/reloads if scene changes (and thus src changes)
  useEffect(() => {
    if (mainVideoRef?.current) {
      mainVideoRef.current.load();
    }
  }, [ scene.generatedVideo?.publicUri, mainVideoRef ]);

  const handleLocalPlay = useCallback(() => {
    if (mainVideoRef?.current) {
      // If paused globally, press local play initiates global play sequence from current scene's start time
      if (!isPlaying) {
        // Seek to start of current scene to ensure correct start point for sequential play if time is off
        mainVideoRef.current.currentTime = scene.startTime;
        onPlayMainVideo?.(); // Triggers global play state change
      } else {
        // If already playing globally, just ensure the local video plays from current time if it paused locally
        if (mainVideoRef.current.paused) {
          mainVideoRef.current.play().catch(err => console.error("Error playing main video locally:", err));
        }
      }
    }
  }, [ isPlaying, onPlayMainVideo, scene.startTime, mainVideoRef ]);

  return (
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
              <Play className="w-4 h-4 mr-1" />
              Play
            </Button>
          ) }
          { isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <Button size="sm" variant="outline" onClick={ onRegenerate } data-testid="button-regenerate">
              <RefreshCw className="w-4 h-4 mr-1" />
              Regenerate
            </Button>
          ) }
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FramePreview title="Start Frame" imageUrl={ scene.startFrame?.publicUri } alt="Start frame" isLoading={ isLoading } />
            <FramePreview title="End Frame" imageUrl={ scene.endFrame?.publicUri } alt="End frame" isLoading={ isLoading } />
          </div>

          { isLoading ? (
            <Card>
              <Skeleton className="w-full aspect-video bg-muted rounded-md" />
            </Card>
          ) : hasVideo && (
            <Card>
              <CardContent className="p-3">
                <video
                  ref={ mainVideoRef }
                  src={ scene.generatedVideo?.publicUri }
                  preload="auto"
                  playsInline={ true }
                  className="aspect-video bg-muted rounded-md flex items-center justify-center"
                  controls={ false } // Custom controls used, disable native ones
                />
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
  );
}
