import QualityScoreBar from '../QualityScoreBar';

export default function QualityScoreBarExample() {
  return (
    <div className="space-y-3 w-64">
      <QualityScoreBar 
        label="Narrative Fidelity" 
        score={{ rating: "PASS", weight: 0.25, details: "Excellent story adherence" }} 
      />
      <QualityScoreBar 
        label="Character Consistency" 
        score={{ rating: "MINOR_ISSUES", weight: 0.2, details: "Slight variation in clothing" }} 
      />
      <QualityScoreBar 
        label="Technical Quality" 
        score={{ rating: "MAJOR_ISSUES", weight: 0.2, details: "Artifacts visible" }} 
        compact 
      />
    </div>
  );
}
