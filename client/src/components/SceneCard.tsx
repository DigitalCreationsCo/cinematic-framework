import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Camera, Sun, Music, Clock, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Scene, StatusType } from "@shared/pipeline-types";
import StatusBadge from "./StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { memo } from "react";
import { useStore } from "@/lib/store";

interface SceneCardProps {
  scene: Scene;
  isSelected?: boolean;
  isLoading?: boolean;
  status: StatusType;
  onSelect?: (sceneId: number) => void;
  onPlay?: (sceneId: number) => void;
}

const SceneCard = memo(function SceneCard({ scene, isSelected, isLoading, status, onSelect, onPlay }: SceneCardProps) {
  const hasVideo = !!scene.generatedVideo?.publicUri;
  const hasStartFrame = !!scene.startFrame?.publicUri;
  status = status || (hasVideo ? "complete" : "pending");

  return (
    <Card
      className={ cn(
        "cursor-pointer transition-all hover-elevate",
        isSelected && "ring-2 ring-primary",
        isLoading && "animate-pulse"
      ) }
      onClick={ () => onSelect?.(scene.id) }
      data-testid={ `card-scene-${scene.id}` }
    >
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="shrink-0 font-mono text-xs">
            { isLoading ? <Skeleton className="h-4 w-10" /> : `#${scene.id}` }
          </Badge>
          { isLoading ? <Skeleton className="h-4 w-32" /> : <span className="text-sm font-medium truncate">{ scene.shotType }</span> }
        </div>
        { isLoading ? <Skeleton className="h-5 w-16" /> : <StatusBadge status={ status } size="sm" /> }
      </CardHeader>

      <CardContent className="p-3 pt-0 space-y-3">
        <div
          className="relative aspect-video bg-muted rounded-md overflow-hidden"
          data-testid={ `scene-thumbnail-${scene.id}` }
        >
          { isLoading || !hasStartFrame ? (
            <Skeleton className="w-full h-full" />
          ) : (
            <img
              src={ scene.startFrame?.publicUri }
              alt={ `Scene ${scene.id} start frame` }
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) }
          { hasVideo && !isLoading && (
            <Button
              size="icon"
              variant="secondary"
              className="absolute inset-0 m-auto w-10 h-10 rounded-full opacity-90"
              onClick={ (e) => {
                e.stopPropagation();
                onPlay?.(scene.id);
              } }
              data-testid={ `button-play-scene-${scene.id}` }
            >
              <Play className="w-5 h-5" />
            </Button>
          ) }
          { status === 'generating' && scene.progressMessage && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10 p-4 text-center">
              <span className="text-xs font-medium text-muted-foreground animate-pulse leading-tight">
                {scene.progressMessage}
              </span>
            </div>
          ) }
          <div className="absolute bottom-1 right-1">
            { isLoading ? <Skeleton className="h-4 w-10" /> : (
              <Badge variant="secondary" className="text-[10px] font-mono">
                { scene.duration }s
              </Badge>
            ) }
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Camera className="w-3 h-3 shrink-0" />
            { isLoading ? <Skeleton className="h-3 w-24" /> : <span className="truncate">{ scene.cameraMovement }</span> }
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Sun className="w-3 h-3 shrink-0" />
            { isLoading ? <Skeleton className="h-3 w-24" /> : <span className="truncate">{ scene.lighting.quality }</span> }
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Music className="w-3 h-3 shrink-0" />
            { isLoading ? <Skeleton className="h-3 w-24" /> : <span className="truncate">{ scene.audioSync }</span> }
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-3 h-3 shrink-0" />
            { isLoading ? <Skeleton className="h-3 w-16" /> : <span className="font-mono">{ scene.startTime.toFixed(1) }s</span> }
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

export default SceneCard;
