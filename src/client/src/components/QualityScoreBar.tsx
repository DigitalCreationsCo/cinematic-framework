import { cn } from "#/lib/utils.js";
import type { QualityScore } from "../../../shared/types/index.js";
import StatusBadge from "./StatusBadge.js";

interface QualityScoreBarProps {
  label: string;
  score: QualityScore;
  compact?: boolean;
}

const ratingToPercent: Record<string, number> = {
  PASS: 100,
  MINOR_ISSUES: 75,
  MAJOR_ISSUES: 50,
  FAIL: 25,
};

const ratingToColor: Record<string, string> = {
  PASS: "bg-chart-3",
  MINOR_ISSUES: "bg-chart-4",
  MAJOR_ISSUES: "bg-chart-5",
  FAIL: "bg-destructive",
};

export default function QualityScoreBar({ label, score, compact = false }: QualityScoreBarProps) {
  const percent = ratingToPercent[ score.rating ] || 0;
  const colorClass = ratingToColor[ score.rating ] || "bg-muted";

  return (
    <div className={ cn("space-y-1", compact ? "text-xs" : "text-sm") } data-testid={ `quality-score-${label.toLowerCase().replace(/\s+/g, '-')}` }>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground font-medium truncate">{ label }</span>
        <StatusBadge status={ score.rating } size="sm" />
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={ cn("h-full rounded-full transition-all", colorClass) }
          style={ { width: `${percent}%` } }
        />
      </div>
      { !compact && score.details && (
        <p className="text-xs text-muted-foreground line-clamp-1">{ score.details }</p>
      ) }
    </div>
  );
}
