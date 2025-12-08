import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, Moon, Sun } from "lucide-react";
import type { PipelineStatus } from "@shared/pipeline-types";
import StatusBadge from "./StatusBadge";
import ConnectionStatus from "./ConnectionStatus";

interface PipelineHeaderProps {
  title: string;
  status: PipelineStatus;
  connected: boolean;
  progress?: { current: number; total: number };
  isDark: boolean;
  onToggleTheme: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onReset?: () => void;
}

export default function PipelineHeader({
  title,
  status,
  connected,
  progress,
  isDark,
  onToggleTheme,
  onStart,
  onPause,
  onReset,
}: PipelineHeaderProps) {
  const isRunning = status === "analyzing" || status === "generating" || status === "evaluating";

  return (
    <header className="h-14 border-b bg-background px-4 flex items-center justify-between gap-4 shrink-0" data-testid="pipeline-header">
      <div className="flex items-center gap-4 min-w-0">
        <h1 className="text-lg font-semibold truncate" data-testid="text-title">{title}</h1>
        <StatusBadge status={status} />
        {progress && (
          <span className="text-sm text-muted-foreground font-mono" data-testid="text-progress">
            {progress.current}/{progress.total} scenes
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <ConnectionStatus connected={connected} />
        
        <div className="flex items-center gap-1">
          {!isRunning ? (
            <Button size="sm" onClick={onStart} disabled={status === "complete"} data-testid="button-start">
              <Play className="w-4 h-4 mr-1" />
              Start
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onPause} data-testid="button-pause">
              <Pause className="w-4 h-4 mr-1" />
              Pause
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={onReset} data-testid="button-reset">
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>

        <Button size="icon" variant="ghost" onClick={onToggleTheme} data-testid="button-theme">
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </div>
    </header>
  );
}
