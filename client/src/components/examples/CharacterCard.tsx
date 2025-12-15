import CharacterCard from '../CharacterCard';
import type { Character } from '@shared/pipeline-types';

// todo: remove mock functionality
const mockCharacter: Character = {
  id: "char_1",
  name: "Elena Vance",
  aliases: ["The Shadow"],
  description: "A battle-hardened warrior with piercing blue eyes and a scar across her left cheek. Mid-30s, athletic build.",
  physicalTraits: {
    hair: "Silver-white, shoulder length, often braided",
    clothing: "Dark leather armor with blue accents",
    accessories: ["Ancient medallion", "Twin daggers"],
    distinctiveFeatures: ["Scar on left cheek", "Blue eyes", "Athletic build"],
  },
  appearanceNotes: [ "Always wears the medallion", "Hair loose in combat scenes" ],
  referenceImages: []
};

export default function CharacterCardExample() {
  return (
    <div className="max-w-sm">
      <CharacterCard 
        character={mockCharacter}
        onSelect={() => console.log('Character selected')}
      />
    </div>
  );
}
