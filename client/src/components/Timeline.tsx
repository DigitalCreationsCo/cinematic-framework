import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Scene, SceneStatus } from "@shared/pipeline-types";

interface TimelineProps {
  scenes: Scene[];
  sceneStatuses: Record<number, SceneStatus>;
  selectedSceneId?: number;
  totalDuration: number;
  onSceneSelect?: (sceneId: number) => void;
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

export default function Timeline({ scenes, sceneStatuses, selectedSceneId, totalDuration, onSceneSelect }: TimelineProps) {
  const pixelsPerSecond = 20;
  const timelineWidth = totalDuration * pixelsPerSecond;

  return (
    <div className="space-y-2" data-testid="timeline">
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>0:00</span>
        <span className="font-mono">{Math.floor(totalDuration / 60)}:{String(Math.floor(totalDuration % 60)).padStart(2, '0')}</span>
      </div>
      
      <ScrollArea className="w-full">
        <div 
          className="relative h-20 bg-muted rounded-md"
          style={{ width: `${Math.max(timelineWidth, 100)}px`, minWidth: '100%' }}
        >
          {scenes.map((scene) => {
            const left = (scene.startTime / totalDuration) * 100;
            const width = (scene.duration / totalDuration) * 100;
            const status = sceneStatuses[scene.id] || "pending";
            const isSelected = scene.id === selectedSceneId;
            const isGenerating = status === "generating" || status === "evaluating";

            return (
              <Tooltip key={scene.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "absolute top-1 bottom-1 rounded-md transition-all cursor-pointer",
                      typeColors[scene.type] || "bg-muted-foreground",
                      intensityOpacity[scene.intensity] || "opacity-70",
                      isSelected && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                      isGenerating && "animate-pulse",
                      status === "failed" && "bg-destructive"
                    )}
                    style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
                    onClick={() => onSceneSelect?.(scene.id)}
                    data-testid={`timeline-segment-${scene.id}`}
                  >
                    <div className="h-full flex items-center justify-center overflow-hidden px-1">
                      <span className="text-[10px] font-mono text-white/80 truncate">
                        {scene.id}
                      </span>
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">#{scene.id}</Badge>
                      <span className="text-xs font-medium">{scene.shotType}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{scene.duration}s - {scene.type}</p>
                    {scene.lyrics && (
                      <p className="text-xs italic line-clamp-2">"{scene.lyrics}"</p>
                    )}
                    <p className="text-xs">{scene.mood}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(typeColors).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className={cn("w-3 h-3 rounded-sm", color)} />
            <span className="text-muted-foreground capitalize">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
