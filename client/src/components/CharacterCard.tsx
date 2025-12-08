import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User } from "lucide-react";
import type { Character } from "@shared/pipeline-types";

interface CharacterCardProps {
  character: Character;
  onSelect?: () => void;
}

export default function CharacterCard({ character, onSelect }: CharacterCardProps) {
  const initials = character.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const referenceImage = character.referenceImageUrls?.[0];

  return (
    <Card 
      className="cursor-pointer hover-elevate"
      onClick={onSelect}
      data-testid={`card-character-${character.id}`}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <Avatar className="w-12 h-12 shrink-0">
            <AvatarImage src={referenceImage} alt={character.name} />
            <AvatarFallback className="bg-muted text-muted-foreground">
              {initials || <User className="w-5 h-5" />}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium truncate">{character.name}</h4>
              <Badge variant="outline" className="text-[10px] font-mono shrink-0">{character.id}</Badge>
            </div>
            
            <p className="text-xs text-muted-foreground line-clamp-2">{character.description}</p>
            
            {character.state?.lastSeen !== undefined && (
              <p className="text-[10px] text-muted-foreground font-mono">
                Last seen: Scene #{character.state.lastSeen}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {character.physicalTraits.distinctiveFeatures.slice(0, 3).map((feature, idx) => (
            <Badge key={idx} variant="secondary" className="text-[10px]">
              {feature}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
