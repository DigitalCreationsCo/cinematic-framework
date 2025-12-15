import SceneDetailPanel from '../SceneDetailPanel';
import type { Scene, Character, Location } from '@shared/pipeline-types';

// todo: remove mock functionality
const mockScene: Scene = {
  id: 1,
  startTime: 0,
  endTime: 6,
  duration: 6,
  musicalDescription: "",
  type: "lyrical",
  lyrics: "Rising from the ashes of yesterday",
  description: "Epic opening shot establishing the world",
  musicChange: "Build from silence to full orchestra",
  intensity: "high",
  mood: "Triumphant hero emerges from darkness, silhouetted against golden light streaming through ancient temple windows",
  tempo: "moderate",
  transitionType: "Fade",
  shotType: "Wide Shot",
  cameraMovement: "Crane Up",
  lighting: {
    quality: "Dappled sunlight",
    colorTemperature: "5500K",
    intensity: "medium",
    motivatedSources: "sunlight",
    direction: "Front-frame"
  },
  audioSync: "Beat Sync",
  continuityNotes: [
    "Match previous scene color grade",
    "Ensure character facing camera right",
    "Golden hour lighting must be consistent"
  ],
  characters: ["char_1"],
  locationId: "loc_1",
  enhancedPrompt: "Cinematic wide shot of a lone warrior silhouette emerging from shadows. Ancient stone temple with moss-covered pillars frames the scene. Golden light streams through gaps in the canopy above, creating dramatic god rays. Camera slowly cranes upward to reveal the full grandeur of the temple interior. Subject is female warrior, silver-white braided hair, dark leather armor with blue accents, athletic build. Mood: triumphant, hopeful, epic scale.",
  evaluation: {
    overall: "ACCEPT",
    scores: {
      narrativeFidelity: { rating: "PASS", weight: 0.25, details: "Story elements accurately represented" },
      characterConsistency: { rating: "PASS", weight: 0.2, details: "Character matches reference" },
      technicalQuality: { rating: "MINOR_ISSUES", weight: 0.2, details: "Slight grain in shadows" },
      emotionalAuthenticity: { rating: "PASS", weight: 0.2, details: "Strong emotional impact achieved" },
      continuity: { rating: "PASS", weight: 0.15, details: "Seamless flow from intro" },
    },
    issues: [],
    feedback: "Excellent scene that captures the intended epic tone",
  },
};

const mockCharacter: Character = {
  id: "char_1",
  name: "Elena Vance",
  aliases: [],
  description: "Battle-hardened warrior",
  age: "", 
  physicalTraits: {
    build: "",
    ethnicity: "",
    hair: "Silver-white, braided",
    clothing: "Dark leather armor",
    accessories: ["Ancient medallion"],
    distinctiveFeatures: ["Scar on left cheek"],
  },
  appearanceNotes: [],
  referenceImages: [],
};

const mockLocation: Location = {
  id: "loc_1",
  name: "Ancient Forest Temple",
  description: "Crumbling stone temple overgrown with vines",
  lightingConditions: {
    quality: "Dappled sunlight",
    colorTemperature: "5500K",
    intensity: "medium",
    motivatedSources: "sunlight",
    direction: "Front-frame"
  },
  timeOfDay: "Late afternoon",
  weather: "Clear",
  colorPalette: ["Warm tones, browns"],
  naturalElements: [],
  manMadeObjects: [],
  referenceImages: []
};

export default function SceneDetailPanelExample() {
  return (
    <div className="h-[600px] w-full max-w-2xl border rounded-md overflow-hidden">
      <SceneDetailPanel 
        scene={mockScene}
        status="complete"
        characters={[mockCharacter]}
        location={mockLocation}
        onRegenerate={() => console.log('Regenerate scene')}
        onPlayVideo={() => console.log('Play video')}
      />
    </div>
  );
}
