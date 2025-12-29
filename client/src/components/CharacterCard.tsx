import { Card, CardContent } from "@/components/ui/card";
import { Users, User as UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Character } from "@shared/pipeline-types";
import { Skeleton } from "@/components/ui/skeleton";
import { memo } from "react";

interface CharacterCardProps {
  character: Character;
  onSelect: (id: string) => void;
  isLoading?: boolean;
  priority?: boolean;
}

const CharacterCard = memo(function CharacterCard({ character, onSelect, isLoading = false, priority = false }: CharacterCardProps) {
  const characterId = character.id;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card
          className="cursor-pointer hover-elevate transition-all overflow-hidden h-full flex flex-col"
          onClick={ () => !isLoading && onSelect(characterId) }
          data-testid={ `character-card-${characterId}` }
        >
          {/* Portrait Image Section - Vertical Orientation */ }
          <div className="relative aspect-[3/4] w-full bg-muted">
            { isLoading ? (
              <Skeleton className="w-full h-full" />
            ) : (
              <>
                { character.referenceImages?.[ 0 ]?.publicUri ? (
                  <img
                    src={ character.referenceImages[ 0 ].publicUri }
                    alt={ character.name }
                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                    loading={ priority ? "eager" : "lazy" }
                    decoding="async"
                    fetchPriority={ priority ? "high" : "auto" }
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted/50">
                    <Users className="w-16 h-16 text-muted-foreground/30" />
                  </div>
                ) }

                {/* Gradient Overlay for Text Visibility */ }
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-90" />

                {/* Title Overlay - Bottom Left */ }
                <div className="absolute bottom-3 left-3 right-3 z-10">
                  <h3 className="text-lg font-bold text-white leading-tight truncate shadow-sm">
                    { character.name }
                  </h3>
                </div>

                {/* ID Badge Overlay - Top Right */ }
                <Badge
                  variant="outline"
                  className="absolute top-2 right-2 z-10 text-[10px] font-mono bg-black/60 text-white border-white/20 backdrop-blur-[2px]"
                >
                  #{ characterId }
                </Badge>
              </>
            ) }
          </div>

          <CardContent className="p-3 flex-1 flex flex-col gap-2">
            { isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                  <UserIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{ character.aliases.join(", ") || "No aliases" }</span>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                  { character.description }
                </p>
              </>
            ) }
          </CardContent>
        </Card>
      </TooltipTrigger>
      <TooltipContent side="right">View Details</TooltipContent>
    </Tooltip>
  );
});

export default CharacterCard;
