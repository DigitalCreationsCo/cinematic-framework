import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Scene, SceneStatus } from "@shared/pipeline-types";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useRef } from "react";

interface TimelineProps {
  scenes: Scene[];
  sceneStatuses: Record<number, SceneStatus>;
  selectedSceneId?: number;
  totalDuration: number;
  currentTime: number;
  isPlaying: boolean;
  audioUrl?: string;
  onSceneSelect?: (sceneId: number) => void;
  onSetTimelineVideoRefs: (refs: (HTMLVideoElement | null)[]) => void;
  isLoading?: boolean;
}

const typeColors: Record<string, string> = {
  lyrical: "bg-chart-1",
  instrumental: "bg-chart-2",
  transition: "bg-chart-3",
  breakdown: "bg-chart-4",
  solo: "bg-chart-5",
  climax: "bg-primary",
};

const intensityOpacity: Record<string, string> = {
  low: "opacity-50",
  medium: "opacity-70",
  high: "opacity-90",
  extreme: "opacity-100",
};

export default function Timeline({ scenes, sceneStatuses, selectedSceneId, totalDuration, currentTime, isPlaying, audioUrl, onSceneSelect, onSetTimelineVideoRefs, isLoading }: TimelineProps) {
  const pixelsPerSecond = 20;
  const timelineWidth = totalDuration * pixelsPerSecond;
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  // Propagate refs up to parent (PlaybackControls)
  useEffect(() => {
    onSetTimelineVideoRefs(videoRefs.current);
  }, [ onSetTimelineVideoRefs, scenes.length ]);

  // Handle local play/pause for timeline videos (only if user audio is NOT present, otherwise they rely on global play state)
  useEffect(() => {
    if (audioUrl === undefined) {
      if (isPlaying) {
        videoRefs.current.forEach(video => {
          if (video) {
            video.play().catch(() => { });
          }
        });
      } else {
        videoRefs.current.forEach(video => {
          if (video) {
            video.pause();
          }
        });
      }
    }
  }, [ isPlaying, audioUrl ]);

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="timeline-skeleton">
        <div className="flex items-center justify-between px-1">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
        </div>
        <Skeleton className="h-20 w-full rounded-md" />
        <div className="flex flex-wrap gap-2">
          { Array.from({ length: 6 }).map((_, i) => (
            <div key={ i } className="flex items-center gap-1">
              <Skeleton className="w-3 h-3 rounded-sm" />
              <Skeleton className="h-4 w-16" />
            </div>
          )) }
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="timeline">
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>0:00</span>
        <span className="font-mono">{ Math.floor(totalDuration / 60) }:{ String(Math.floor(totalDuration % 60)).padStart(2, '0') }</span>
      </div>

      <ScrollArea className="w-full">
        <div
          className="relative h-20 bg-muted rounded-md"
          style={ { width: `${Math.max(timelineWidth, 100)}px`, minWidth: '100%' } }
        >
          { scenes.map((scene, index) => {
            const left = (scene.startTime / totalDuration) * 100;
            const width = (scene.duration / totalDuration) * 100;
            const status = sceneStatuses[ scene.id ] || "pending";
            const isSelected = scene.id === selectedSceneId;
            const isGenerating = status === "generating" || status === "evaluating";

            return (
              <Tooltip key={ scene.id }>
                <TooltipTrigger asChild>
                  <button
                    className={ cn(
                      "absolute top-1 bottom-1 rounded-md transition-all cursor-pointer",
                      typeColors[ scene.type ] || "bg-muted-foreground",
                      intensityOpacity[ scene.intensity ] || "opacity-70",
                      isSelected && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                      isGenerating && "animate-pulse",
                      status === "failed" && "bg-destructive"
                    ) }
                    style={ { left: `${left}%`, width: `${Math.max(width, 2)}%` } }
                    onClick={ () => onSceneSelect?.(scene.id) }
                    data-testid={ `timeline-segment-${scene.id}` }
                  >
                    <video
                      ref={ el => videoRefs.current[ index ] = el }
                      src={ scene.generatedVideo?.publicUri }
                      className="h-full flex items-center justify-center overflow-hidden"
                      controls={ false }
                    >
                      <span className="text-[10px] font-mono text-white/80 truncate">
                        { scene.id }
                      </span>
                    </video>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">#{ scene.id }</Badge>
                      <span className="text-xs font-medium">{ scene.shotType }</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{ scene.duration }s - { scene.type }</p>
                    { scene.lyrics && (
                      <p className="text-xs italic line-clamp-2">"{ scene.lyrics }"</p>
                    ) }
                    <p className="text-xs">{ scene.mood }</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          }) }
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="flex flex-wrap gap-2 text-xs">
        { Object.entries(typeColors).map(([ type, color ]) => (
          <div key={ type } className="flex items-center gap-1">
            <div className={ cn("w-3 h-3 rounded-sm", color) } />
            <span className="text-muted-foreground capitalize">{ type }</span>
          </div>
        )) }
      </div>
    </div>
  );
}
