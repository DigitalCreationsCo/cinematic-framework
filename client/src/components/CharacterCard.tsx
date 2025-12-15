import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, User as UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Character } from "@shared/pipeline-types";
import { Skeleton } from "@/components/ui/skeleton"; // Import Skeleton
import { memo } from "react";

interface CharacterCardProps {
  character: Character;
  onSelect: (id: string) => void;
  isLoading?: boolean; // Added isLoading prop
}

const CharacterCard = memo(function CharacterCard({ character, onSelect, isLoading = false }: CharacterCardProps) {
  const characterId = character.id;
  const cardTitle = isLoading ? <Skeleton className="h-4 w-3/4" /> : character.name;

  return (
    <Card
      className="cursor-pointer hover-elevate transition-all"
      onClick={ () => !isLoading && onSelect(characterId) }
      data-testid={ `character-card-${characterId}` }
    >
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium truncate">
            { cardTitle }
          </CardTitle>
          { isLoading ? (
            <Skeleton className="h-5 w-12" />
          ) : (
            <Badge variant="outline" className="text-[10px] font-mono shrink-0">#{ characterId }</Badge>
          ) }
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-2">
        { isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full rounded-md mb-2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <>
            <div className="relative w-full h-20 bg-muted rounded-md overflow-hidden">
              { character.referenceImages?.[ 0 ]?.publicUri ? (
                <img
                  src={ character.referenceImages[ 0 ].publicUri }
                  alt={ character.name }
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Users className="w-8 h-8 text-muted-foreground/50" />
                </div>
              ) }
            </div>

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <UserIcon className="w-3 h-3" />
              <span className="truncate">{ character.aliases.join(", ") }</span>
            </div>

            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{ character.description }</p>
          </>
        ) }
      </CardContent>
    </Card>
  );
});

export default CharacterCard;
