import QualityEvaluationPanel from '../QualityEvaluationPanel';
import type { QualityEvaluationResult } from '@shared/pipeline-types';

// todo: remove mock functionality
const mockEvaluation: QualityEvaluationResult = {
  overall: "ACCEPT_WITH_NOTES",
  scores: {
    narrativeFidelity: { rating: "PASS", weight: 0.25, details: "Story elements accurately represented" },
    characterConsistency: { rating: "MINOR_ISSUES", weight: 0.2, details: "Slight variation in clothing color" },
    technicalQuality: { rating: "PASS", weight: 0.2, details: "Good resolution and clarity" },
    emotionalAuthenticity: { rating: "PASS", weight: 0.2, details: "Strong emotional resonance" },
    continuity: { rating: "PASS", weight: 0.15, details: "Smooth transition from previous scene" },
  },
  issues: [
    {
      department: "costume",
      category: "Character Appearance",
      severity: "minor",
      description: "Hero's jacket appears slightly darker than reference",
      videoTimestamp: "00:02.5",
      suggestedFix: "Adjust color grading in post or regenerate with explicit color instruction",
    },
    {
      department: "gaffer",
      category: "Lighting",
      severity: "major",
      description: "Backlight intensity inconsistent with previous scene",
      suggestedFix: "Add explicit lighting intensity to prompt",
    },
  ],
  feedback: "Scene achieves narrative goals with minor visual inconsistencies that don't impact story comprehension.",
  ruleSuggestion: "Always specify exact clothing colors using hex codes in character descriptions",
};

export default function QualityEvaluationPanelExample() {
  return (
    <div className="max-w-sm">
      <QualityEvaluationPanel evaluation={mockEvaluation} sceneId={1} />
    </div>
  );
}
