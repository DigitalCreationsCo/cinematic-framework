import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, Moon, Sun, Square } from "lucide-react";
import StatusBadge from "./StatusBadge";
import ConnectionStatus from "./ConnectionStatus";
import { useStore } from "@/lib/store";
import { Scene } from "@shared/pipeline-types";
import { useCallback } from "react";

interface PipelineHeaderProps {
  title: string;
  handleStart: () => void;
  handleStop: () => void;
  handleResume: () => void;
  onPause: () => void;
  handleResetDashboard: () => void;
}

export default function PipelineHeader({ title, handleStart, handleStop, handleResume, onPause, handleResetDashboard }: PipelineHeaderProps) {
  const {
    pipelineState,
    pipelineStatus,
    connectionStatus,
    isDark,
    setIsDark
  } = useStore();

  const isRunning = pipelineStatus === "running" || pipelineStatus === "generating" || pipelineStatus === "analyzing" || pipelineStatus === "evaluating";
  title = title || pipelineState?.storyboard?.metadata.title || "Untitled Project";
  const progress = pipelineState?.storyboardState ? {
    current: pipelineState.storyboardState.scenes.filter((s: Scene) => s.generatedVideo).length,
    total: pipelineState.storyboardState.scenes.length,
  } : undefined;

  const handleToggleTheme = useCallback(() => setIsDark(!isDark), [ isDark, setIsDark ]);
  
  return (
    <header className="h-14 border-b bg-background px-4 flex items-center justify-between gap-4 shrink-0" data-testid="pipeline-header">
      <div className="flex items-center gap-4 min-w-0">
        <h1 className="text-lg font-semibold truncate" data-testid="text-title">{ title }</h1>
        <div>
          <span className="text-sm text-muted-foreground font-mono pr-2">
            Pipeline Status:
          </span>
          <StatusBadge status={ pipelineStatus } />
        </div>
        { progress && (
          <span className="text-sm text-muted-foreground font-mono" data-testid="text-progress">
            { progress.current }/{ progress.total } scenes
          </span>
        ) }
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <ConnectionStatus connected={ connectionStatus === 'connected' } />

        <div className="flex items-center gap-1">
          { !isRunning ? (
            <Button size="sm" onClick={ pipelineStatus === 'paused' ? handleResume : handleStart } disabled={ pipelineStatus === "error" }>
              <Play className="w-4 h-4 mr-1" />
              { pipelineStatus === 'paused' ? 'Resume Pipeline' : 'Start Pipeline' }
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={ handleStop }>
              <Square className="w-4 h-4 mr-1" />
              Stop
            </Button>
          ) }
        </div>

        <Button size="icon" variant="ghost" onClick={ handleToggleTheme } data-testid="button-theme">
          { isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" /> }
        </Button>
      </div>
    </header>
  );
}
