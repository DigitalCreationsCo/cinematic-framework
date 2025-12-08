import { cn } from "@/lib/utils";

interface ConnectionStatusProps {
  connected: boolean;
  className?: string;
}

export default function ConnectionStatus({ connected, className }: ConnectionStatusProps) {
  return (
    <div 
      className={cn("flex items-center gap-2 text-xs", className)}
      data-testid="connection-status"
    >
      <span 
        className={cn(
          "w-2 h-2 rounded-full",
          connected ? "bg-chart-3 animate-pulse" : "bg-destructive"
        )} 
      />
      <span className="text-muted-foreground">
        {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}
