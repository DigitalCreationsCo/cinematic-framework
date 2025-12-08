import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Sun, Cloud } from "lucide-react";
import type { Location } from "@shared/pipeline-types";

interface LocationCardProps {
  location: Location;
  onSelect?: () => void;
}

export default function LocationCard({ location, onSelect }: LocationCardProps) {
  const referenceImage = location.referenceImageUrls?.[0];

  return (
    <Card 
      className="cursor-pointer hover-elevate overflow-hidden"
      onClick={onSelect}
      data-testid={`card-location-${location.id}`}
    >
      <div className="relative aspect-video bg-muted">
        {referenceImage ? (
          <img 
            src={referenceImage}
            alt={location.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <MapPin className="w-8 h-8 text-muted-foreground/50" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-2 left-2 right-2">
          <h4 className="text-sm font-medium text-white truncate">{location.name}</h4>
        </div>
        <Badge variant="outline" className="absolute top-2 right-2 text-[10px] font-mono bg-black/50 text-white border-white/20">
          {location.id}
        </Badge>
      </div>
      
      <CardContent className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground line-clamp-2">{location.description}</p>
        
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Sun className="w-3 h-3" />
            <span className="truncate">{location.lightingConditions}</span>
          </div>
          <div className="flex items-center gap-1">
            <Cloud className="w-3 h-3" />
            <span>{location.timeOfDay}</span>
          </div>
        </div>

        {location.state?.lastUsed !== undefined && (
          <p className="text-[10px] text-muted-foreground font-mono">
            Last used: Scene #{location.state.lastUsed}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
