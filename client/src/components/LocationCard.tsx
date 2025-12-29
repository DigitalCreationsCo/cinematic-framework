import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Sun, Cloud } from "lucide-react";
import type { Location } from "@shared/pipeline-types";
import { Skeleton } from "@/components/ui/skeleton"; // Import Skeleton
import { memo } from "react";

interface LocationCardProps {
  location: Location;
  onSelect?: (id: string) => void;
  isLoading?: boolean; // Added isLoading prop
  priority?: boolean;
}

const LocationCard = memo(function LocationCard({ location, onSelect, isLoading = false, priority = false }: LocationCardProps) {
  const referenceImage = location.referenceImages?.[ 0 ];

  return (
    <Card
      className={ "cursor-pointer hover-elevate overflow-hidden" }
      onClick={ () => onSelect?.(location.id) }
      data-testid={ `card-location-${location.id}` }
    >
      <div className="relative aspect-video bg-muted">
        { isLoading ? (
          <Skeleton className="w-full h-full" />
        ) : referenceImage ? (
          <img
            src={ referenceImage.publicUri }
            alt={ location.name }
            className="w-full h-full object-cover"
            loading={ priority ? "eager" : "lazy" }
            decoding="async"
            fetchPriority={ priority ? "high" : "auto" }
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <MapPin className="w-8 h-8 text-muted-foreground/50" />
          </div>
        ) }
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-2 left-2 right-2">
          <h4 className="text-sm font-medium text-white truncate">
            { isLoading ? <Skeleton className="h-4 w-3/4" /> : location.name }
          </h4>
        </div>
        <Badge variant="outline" className="absolute top-2 right-2 text-[10px] font-mono bg-black/50 text-white border-white/20">
          { isLoading ? <Skeleton className="h-3 w-4" /> : location.id }
        </Badge>
      </div>

      <CardContent className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground line-clamp-2">
          { isLoading ? <Skeleton className="h-4 w-full mb-1" /> : location.description }
        </p>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Sun className="w-3 h-3" />
            <span className="truncate">
              { isLoading ? <Skeleton className="h-3 w-16" /> : location.lightingConditions.quality.Hardness }
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Cloud className="w-3 h-3" />
            <span>{ isLoading ? <Skeleton className="h-3 w-12" /> : location.timeOfDay }</span>
          </div>
        </div>

        { isLoading ? (
          <Skeleton className="h-4 w-24 mt-2" />
        ) : (
          location.state?.lastUsed !== undefined && (
            <p className="text-[10px] text-muted-foreground font-mono">
              Last used: Scene #{ location.state.lastUsed }
            </p>
          )
        ) }
      </CardContent>
    </Card>
  );
});

export default LocationCard;
