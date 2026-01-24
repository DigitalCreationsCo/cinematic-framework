import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Badge } from "#/components/ui/badge";
import { ChevronDown, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { useState } from "react";
import type { QualityEvaluationResult, QualityIssue } from "#shared/types/workflow.types";
import QualityScoreBar from "./QualityScoreBar";
import StatusBadge from "./StatusBadge";

interface QualityEvaluationPanelProps {
  evaluation: QualityEvaluationResult;
  sceneId?: string;
}

const severityIcons = {
  critical: AlertCircle,
  major: AlertTriangle,
  minor: Info,
};

const severityColors = {
  critical: "text-destructive",
  major: "text-chart-5",
  minor: "text-chart-4",
};

function IssueItem({ issue }: { issue: QualityIssue; }) {
  const Icon = severityIcons[ issue.severity ];
  const [ isOpen, setIsOpen ] = useState(false);

  return (
    <Collapsible open={ isOpen } onOpenChange={ setIsOpen }>
      <CollapsibleTrigger className="w-full flex items-start gap-2 p-2 rounded-md hover-elevate text-left">
        <Icon className={ `w-4 h-4 mt-0.5 shrink-0 ${severityColors[ issue.severity ]}` } />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{ issue.category }</span>
            <Badge variant="outline" className="text-[10px]">{ issue.severity }</Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">{ issue.description }</p>
        </div>
        <ChevronDown className={ `w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}` } />
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-6 pr-2 pb-2">
        <div className="space-y-2 text-xs">
          <p className="text-foreground">{ issue.description }</p>
          { issue.videoTimestamp && (
            <p className="text-muted-foreground font-mono">Timestamp: { issue.videoTimestamp }</p>
          ) }
          <div className="p-2 bg-muted rounded-md">
            <p className="text-muted-foreground font-medium mb-1">Suggested Fix:</p>
            <p>{ issue.suggestedFix }</p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function QualityEvaluationPanel({ evaluation, sceneId }: QualityEvaluationPanelProps) {
  const [ showIssues, setShowIssues ] = useState(false);

  return (
    <Card data-testid={ `panel-quality-evaluation${sceneId ? `-${sceneId}` : ''}` }>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">Quality Evaluation</CardTitle>
          <StatusBadge status={ evaluation.grade } />
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-4">
        <div className="space-y-3">
          <QualityScoreBar label="Narrative Fidelity" score={ evaluation.scores.narrativeFidelity } compact />
          <QualityScoreBar label="Character Consistency" score={ evaluation.scores.characterConsistency } compact />
          <QualityScoreBar label="Technical Quality" score={ evaluation.scores.technicalQuality } compact />
          <QualityScoreBar label="Emotional Authenticity" score={ evaluation.scores.emotionalAuthenticity } compact />
          <QualityScoreBar label="Continuity" score={ evaluation.scores.continuity } compact />
        </div>

        { evaluation.feedback && (
          <p className="text-xs text-muted-foreground border-t pt-3">{ evaluation.feedback }</p>
        ) }

        { evaluation.issues.length > 0 && (
          <Collapsible open={ showIssues } onOpenChange={ setShowIssues }>
            <CollapsibleTrigger className="w-full flex items-center justify-between p-2 rounded-md hover-elevate" data-testid="button-toggle-issues">
              <span className="text-xs font-medium">Issues ({ evaluation.issues.length })</span>
              <ChevronDown className={ `w-4 h-4 text-muted-foreground transition-transform ${showIssues ? 'rotate-180' : ''}` } />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 mt-2">
              { evaluation.issues.map((issue, idx) => (
                <IssueItem key={ idx } issue={ issue } />
              )) }
            </CollapsibleContent>
          </Collapsible>
        ) }

        { evaluation.ruleSuggestion && (
          <div className="p-2 bg-accent rounded-md">
            <p className="text-xs font-medium text-accent-foreground mb-1">Rule Suggestion</p>
            <p className="text-xs text-accent-foreground/80">{ evaluation.ruleSuggestion }</p>
          </div>
        ) }
      </CardContent>
    </Card>
  );
}
