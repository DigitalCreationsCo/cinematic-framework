import { ScrollArea } from "#/components/ui/scroll-area.js";
import { AlertCircle, AlertTriangle, Info, CheckCircle, X } from "lucide-react";
import { cn } from "#/lib/utils.js";
import type { PipelineMessage } from "../../../shared/types/pipeline.types.js";
import { memo } from "react";

interface MessageLogProps {
  messages: PipelineMessage[];
  maxHeight?: string;
  onDismiss?: (id: string) => void;
}

const typeConfig = {
  info: { icon: Info, className: "text-chart-1 bg-chart-1/10" },
  warn: { icon: AlertTriangle, className: "text-chart-4 bg-chart-4/10" },
  error: { icon: AlertCircle, className: "text-destructive bg-destructive/10" },
  success: { icon: CheckCircle, className: "text-chart-3 bg-chart-3/10" },
};

const MessageLog = memo(function MessageLog({ messages, maxHeight = "12rem", onDismiss }: MessageLogProps) {
  if (messages.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-4" data-testid="message-log-empty">
        No messages
      </div>
    );
  }

  return (
    <ScrollArea className="w-full" style={ { maxHeight } } data-testid="message-log">
      <div className="space-y-1 pr-3">
        { messages.map((msg) => {
          const config = typeConfig[ msg.type ];
          const Icon = config.icon;

          return (
            <div
              key={ msg.id }
              className={ cn(
                "flex items-start gap-2 p-2 rounded-md text-xs",
                config.className
              ) }
              data-testid={ `message-${msg.id}` }
            >
              <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="break-words">{ msg.message }</p>
                <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                  <span className="font-mono">
                    { msg.timestamp.toDateString() }
                  </span>
                  { msg.sceneId !== undefined && (
                    <span className="font-mono">Scene #{ msg.sceneId }</span>
                  ) }
                </div>
              </div>
              { onDismiss && (
                <button
                  onClick={ () => onDismiss(msg.id) }
                  className="shrink-0 p-0.5 rounded hover-elevate"
                  data-testid={ `button-dismiss-${msg.id}` }
                >
                  <X className="w-3 h-3" />
                </button>
              ) }
            </div>
          );
        }) }
      </div>
    </ScrollArea>
  );
});

export default MessageLog;
