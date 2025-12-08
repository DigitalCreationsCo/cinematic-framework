import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, RefreshCw, Camera, Sun, Music, Users, MapPin, FileText } from "lucide-react";
import type { Scene, SceneStatus, Character, Location } from "@shared/pipeline-types";
import StatusBadge from "./StatusBadge";
import QualityEvaluationPanel from "./QualityEvaluationPanel";
import FramePreview from "./FramePreview";

interface SceneDetailPanelProps {
  scene: Scene;
  status: SceneStatus;
  characters?: Character[];
  location?: Location;
  onRegenerate?: () => void;
  onPlayVideo?: () => void;
}

export default function SceneDetailPanel({ 
  scene, 
  status, 
  characters = [], 
  location,
  onRegenerate,
  onPlayVideo 
}: SceneDetailPanelProps) {
  const hasVideo = !!scene.generatedVideoUrl;

  return (
    <div className="h-full flex flex-col" data-testid={`panel-scene-detail-${scene.id}`}>
      <div className="p-4 border-b flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Badge variant="outline" className="font-mono text-sm shrink-0">#{scene.id}</Badge>
          <h2 className="text-lg font-semibold truncate">{scene.shotType}</h2>
          <StatusBadge status={status} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasVideo && (
            <Button size="sm" onClick={onPlayVideo} data-testid="button-play-video">
              <Play className="w-4 h-4 mr-1" />
              Play
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onRegenerate} data-testid="button-regenerate">
            <RefreshCw className="w-4 h-4 mr-1" />
            Regenerate
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FramePreview title="Start Frame" imageUrl={scene.startFrameUrl} alt="Start frame" />
            <FramePreview title="End Frame" imageUrl={scene.endFrameUrl} alt="End frame" />
          </div>

          {hasVideo && (
            <Card>
              <CardContent className="p-3">
                <div className="aspect-video bg-muted rounded-md flex items-center justify-center">
                  <Button size="lg" variant="secondary" onClick={onPlayVideo}>
                    <Play className="w-6 h-6 mr-2" />
                    Preview Video
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

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
                    <span className="font-medium">{scene.cameraMovement}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Sun className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Lighting:</span>
                    <span className="font-medium">{scene.lighting}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Music className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Audio Sync:</span>
                    <span className="font-medium">{scene.audioSync}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="font-mono ml-2">{scene.duration}s</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Time:</span>
                    <span className="font-mono ml-2">{scene.startTime.toFixed(1)}s - {scene.endTime.toFixed(1)}s</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Transition:</span>
                    <span className="ml-2">{scene.transitionType}</span>
                  </div>
                </div>
              </div>

              <Card>
                <CardHeader className="p-3 pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Mood</CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <p className="text-sm">{scene.mood}</p>
                </CardContent>
              </Card>

              {scene.lyrics && (
                <Card>
                  <CardHeader className="p-3 pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Lyrics</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <p className="text-sm italic">"{scene.lyrics}"</p>
                  </CardContent>
                </Card>
              )}

              {location && (
                <Card>
                  <CardHeader className="p-3 pb-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <CardTitle className="text-sm font-medium">{location.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <p className="text-xs text-muted-foreground">{location.description}</p>
                  </CardContent>
                </Card>
              )}

              {characters.length > 0 && (
                <Card>
                  <CardHeader className="p-3 pb-2">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <CardTitle className="text-sm font-medium">Characters</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <div className="flex flex-wrap gap-2">
                      {characters.map((char) => (
                        <Badge key={char.id} variant="secondary">{char.name}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="quality" className="mt-4">
              {scene.evaluation ? (
                <QualityEvaluationPanel evaluation={scene.evaluation} sceneId={scene.id} />
              ) : (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground">
                    No quality evaluation available yet
                  </CardContent>
                </Card>
              )}
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
                  {scene.enhancedPrompt ? (
                    <p className="text-sm font-mono whitespace-pre-wrap bg-muted p-3 rounded-md">
                      {scene.enhancedPrompt}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No enhanced prompt generated yet</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="continuity" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="p-3 pb-2">
                  <CardTitle className="text-sm font-medium">Continuity Notes</CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {scene.continuityNotes.length > 0 ? (
                    <ul className="space-y-1">
                      {scene.continuityNotes.map((note, idx) => (
                        <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                          <span className="text-muted-foreground/50">•</span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No continuity notes</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-3 pb-2">
                  <CardTitle className="text-sm font-medium">Audio Details</CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Type:</span>
                    <Badge variant="outline">{scene.type}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Intensity:</span>
                    <Badge variant="outline">{scene.intensity}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Tempo:</span>
                    <Badge variant="outline">{scene.tempo}</Badge>
                  </div>
                  {scene.musicChange && (
                    <div className="pt-2 border-t">
                      <span className="text-xs text-muted-foreground">Music Change:</span>
                      <p className="text-sm mt-1">{scene.musicChange}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
