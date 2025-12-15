import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Camera, Sun, Music, Clock, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Scene, SceneStatus } from "@shared/pipeline-types";
import StatusBadge from "./StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { memo } from "react";
import { useStore } from "@/lib/store";
import { regenerateScene } from "@/lib/api";

interface SceneCardProps {
  scene: Scene & { status?: SceneStatus; };
  isSelected?: boolean;
  isLoading?: boolean;
}

const SceneCard = memo(function SceneCard({ scene, isSelected, isLoading }: SceneCardProps) {
  const { setSelectedSceneId, selectedProject } = useStore(state => ({
    setSelectedSceneId: state.setSelectedSceneId,
    selectedProject: state.selectedProject,
  }));

  const handleRegenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedProject) return;
    await regenerateScene({ projectId: selectedProject, sceneId: scene.id, forceRegenerate: true });
  };

  const hasVideo = !!scene.generatedVideo?.publicUri;
  const hasStartFrame = !!scene.startFrame?.publicUri;
  const status = scene.status || (hasVideo ? "complete" : "pending");

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover-elevate",
        isSelected && "ring-2 ring-primary",
        isLoading && "animate-pulse"
      )}
      onClick={ () => setSelectedSceneId(scene.id) }
      data-testid={`card-scene-${scene.id}`}
    >
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="shrink-0 font-mono text-xs">
            #{ scene.id }
          </Badge>
          <span className="text-sm font-medium truncate">{ scene.shotType }</span>
        </div>
        <StatusBadge status={ status } size="sm" />
      </CardHeader>

      <CardContent className="p-3 pt-0 space-y-3">
        <div
          className="relative aspect-video bg-muted rounded-md overflow-hidden"
          data-testid={`scene-thumbnail-${scene.id}`}
        >
          { !hasStartFrame ? (
            <Skeleton className="w-full h-full" />
          ) : (
              <img
                src={ scene.startFrame?.publicUri }
              alt={`Scene ${scene.id} start frame`}
              className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
            />
          )}
          { hasVideo && (
            <Button
              size="icon"
              variant="secondary"
              className="absolute inset-0 m-auto w-10 h-10 rounded-full opacity-90"
              onClick={(e) => {
                e.stopPropagation();
                // onPlay?.(scene.id);
              }}
              data-testid={`button-play-scene-${scene.id}`}
            >
              <Play className="w-5 h-5" />
            </Button>
          )}
          <div className="absolute bottom-1 right-1">
            <Badge variant="secondary" className="text-[10px] font-mono">
              { scene.duration }s
            </Badge>
          </div>
        </div>

        {/* Regeneration Button */ }
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={ handleRegenerate } disabled={ status === 'generating' }>
            <RefreshCw className="w-4 h-4 mr-2" />
            Regenerate
          </Button>
        </div>


        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Camera className="w-3 h-3 shrink-0" />
            <span className="truncate">{ scene.cameraMovement }</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Sun className="w-3 h-3 shrink-0" />
            <span className="truncate">{ scene.lighting.quality }</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Music className="w-3 h-3 shrink-0" />
            <span className="truncate">{ scene.audioSync }</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="font-mono">{ scene.startTime.toFixed(1) }s</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

export default SceneCard;
