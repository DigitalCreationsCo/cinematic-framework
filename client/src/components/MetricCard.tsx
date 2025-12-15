import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton"; // Import Skeleton
import { memo } from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: React.ReactNode;
  isLoading?: boolean; // Added isLoading prop
}

const MetricCard = memo(function MetricCard({ label, value, subValue, trend, trendValue, icon, isLoading }: MetricCardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <Card data-testid={ `metric-${label.toLowerCase().replace(/\s+/g, '-')}` }>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
              { isLoading ? <Skeleton className="h-4 w-24" /> : label }
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              { isLoading ? <Skeleton className="h-6 w-20 mt-1" /> : value }
            </p>
            { subValue && (
              <p className="text-xs text-muted-foreground">
                { isLoading ? <Skeleton className="h-3 w-16 mt-0.5" /> : subValue }
              </p>
            ) }
          </div>
          { isLoading ? (
            <div className="shrink-0 pt-1">
              <Skeleton className="w-6 h-6" />
            </div>
          ) : icon && (
            <div className="text-muted-foreground shrink-0">{ icon }</div>
          ) }
        </div>
        { isLoading ? (
          <Skeleton className="h-4 w-24 mt-3" />
        ) : (
          trend && trendValue && (
            <div className={ cn(
              "flex items-center gap-1 mt-2 text-xs font-medium",
              trend === "up" && "text-chart-3",
              trend === "down" && "text-destructive",
              trend === "neutral" && "text-muted-foreground"
            ) }>
              <TrendIcon className="w-3 h-3" />
              <span>{ trendValue }</span>
            </div>
          )
        ) }
      </CardContent>
    </Card>
  );
});

export default MetricCard;
