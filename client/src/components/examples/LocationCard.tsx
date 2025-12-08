import LocationCard from '../LocationCard';
import type { Location } from '@shared/pipeline-types';

// todo: remove mock functionality
const mockLocation: Location = {
  id: "loc_1",
  name: "Ancient Forest Temple",
  description: "A crumbling stone temple overgrown with vines, shafts of light piercing through the canopy above. Moss-covered pillars line the entrance.",
  lightingConditions: "Dappled sunlight through leaves",
  timeOfDay: "Late afternoon",
  state: {
    lastUsed: 2,
    lighting: "Golden hour",
    weather: "Clear",
    timeOfDay: "Sunset",
  },
};

export default function LocationCardExample() {
  return (
    <div className="max-w-xs">
      <LocationCard 
        location={mockLocation}
        onSelect={() => console.log('Location selected')}
      />
    </div>
  );
}
