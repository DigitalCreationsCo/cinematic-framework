import SceneCard from '../SceneCard';
import type { Scene } from '@shared/pipeline-types';

// todo: remove mock functionality
const mockScene: Scene = {
  id: 1,
  startTime: 0,
  endTime: 6,
  duration: 6,
  type: "lyrical",
  lyrics: "Rising from the ashes of yesterday",
  description: "Epic opening shot establishing the world",
  musicChange: "Build from silence to full orchestra",
  intensity: "high",
  mood: "Triumphant hero emerges from darkness into light",
  tempo: "moderate",
  transitionType: "Fade",
  shotType: "Wide Shot",
  cameraMovement: "Crane Up",
  lighting: "Dramatic backlight",
  audioSync: "Beat Sync",
  continuityNotes: ["Match previous scene color grade"],
  characters: ["char_1"],
  locationId: "loc_1",
  enhancedPrompt: "Cinematic wide shot of hero silhouette...",
  evaluation: {
    overall: "ACCEPT",
    scores: {
      narrativeFidelity: { rating: "PASS", weight: 0.25, details: "Excellent" },
      characterConsistency: { rating: "PASS", weight: 0.2, details: "Good" },
      technicalQuality: { rating: "MINOR_ISSUES", weight: 0.2, details: "Minor artifacts" },
      emotionalAuthenticity: { rating: "PASS", weight: 0.2, details: "Strong emotional impact" },
      continuity: { rating: "PASS", weight: 0.15, details: "Seamless" },
    },
    issues: [],
    feedback: "Scene meets quality standards",
  }
};

export default function SceneCardExample() {
  return (
    <div className="grid grid-cols-2 gap-4 max-w-lg">
      <SceneCard 
        scene={mockScene} 
        status="complete" 
        onSelect={() => console.log('Scene selected')}
        onPlay={() => console.log('Play scene')}
      />
      <SceneCard 
        scene={{ ...mockScene, id: 2, evaluation: undefined }} 
        status="generating" 
      />
    </div>
  );
}
