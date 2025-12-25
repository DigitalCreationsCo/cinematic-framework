import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PipelineStatus, SceneStatus, StatusType } from "@shared/pipeline-types";


interface StatusBadgeProps {
  status: StatusType;
  size?: "sm" | "default";
  className?: string;
}

const statusConfig: Record<StatusType, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string; }> = {
  ready: { label: "Ready", variant: "secondary", className: "bg-muted text-muted-foreground" },
  pending: { label: "Pending", variant: "secondary", className: "bg-muted text-muted-foreground" },
  analyzing: { label: "Analyzing", variant: "default", className: "bg-chart-1 text-white animate-pulse" },
  generating: { label: "Generating", variant: "default", className: "bg-chart-4 text-white animate-pulse" },
  evaluating: { label: "Evaluating", variant: "default", className: "bg-chart-2 text-white animate-pulse" },
  complete: { label: "Complete", variant: "default", className: "bg-chart-3 text-white" },
  error: { label: "Error", variant: "destructive", className: "" },
  PASS: { label: "Pass", variant: "default", className: "bg-chart-3 text-white" },
  MINOR_ISSUES: { label: "Minor Issues", variant: "default", className: "bg-chart-4 text-white" },
  MAJOR_ISSUES: { label: "Major Issues", variant: "default", className: "bg-chart-5 text-white" },
  FAIL: { label: "Fail", variant: "destructive", className: "" },
  ACCEPT: { label: "Accept", variant: "default", className: "bg-chart-3 text-white" },
  ACCEPT_WITH_NOTES: { label: "Accept w/ Notes", variant: "default", className: "bg-chart-3/80 text-white" },
  REGENERATE_MINOR: { label: "Regen Minor", variant: "default", className: "bg-chart-4 text-white" },
  REGENERATE_MAJOR: { label: "Regen Major", variant: "default", className: "bg-chart-5 text-white" },
  paused: {
    label: "Paused",
    variant: "default",
    className: ""
  }
};

export default function StatusBadge({ status, size = "default", className }: StatusBadgeProps) {
  const config = statusConfig[ status ] || { label: status, variant: "secondary" as const, className: "" };

  return (
    <Badge
      variant={ config.variant }
      className={ cn(
        size === "sm" && "text-[10px] px-1.5 py-0",
        config.className,
        className
      ) }
      data-testid={ `badge-status-${status}` }
    >
      { config.label }
    </Badge>
  );
}
