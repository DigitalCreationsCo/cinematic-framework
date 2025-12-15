# Quality Evaluation Best Practices & Additional Suggestions

## Quick Win Improvements

### 1. **Add Generation Rules at Workflow Start**

In [`pipeline/graph.ts`](pipeline/graph.ts), add domain detection at the beginning:

```typescript
import { detectRelevantDomainRules, getProactiveRules } from "./prompts/generation-rules-presets";

// In your workflow initialization (before scene generation)
export const initializeGenerationRules = (state: WorkflowState): WorkflowState => {
  const sceneDescriptions = state.scenes.map(s => s.description);

  // Detect domain-specific rules
  const domainRules = detectRelevantDomainRules(sceneDescriptions);

  // Get proactive rules (always active)
  const proactiveRules = getProactiveRules();

  // Combine with existing rules
  const allRules = [
    ...proactiveRules,
    ...domainRules,
    ...(state.generationRules || [])
  ];

  // Deduplicate
  const uniqueRules = Array.from(new Set(allRules));

  console.log(`\n📚 GENERATION RULES INITIALIZED`);
  console.log(`   Proactive rules: ${proactiveRules.length}`);
  console.log(`   Domain-specific rules: ${domainRules.length}`);
  console.log(`   Total active rules: ${uniqueRules.length}`);

  return {
    ...state,
    generationRules: uniqueRules
  };
};
```

### 2. **Add Retry Handler Integration**

Update frame-composition-agent.ts:

```typescript
import { QualityRetryHandler } from "../utils/quality-retry-handler";
import { RetryContext } from "../utils/retry-logger";

private async generateImageWithQualityCheck(
  scene: Scene,
  prompt: string,
  framePosition: "start" | "end",
  characters: Character[],
  locations: Location[],
  previousFrame: string | undefined,
  referenceImageUrls: (string | undefined)[] = [],
): Promise<string> {

  const context: RetryContext = {
    type: 'frame',
    sceneId: scene.id,
    framePosition,
    attempt: 1,
    maxAttempts: this.qualityAgent.qualityConfig.maxRetries
  };

  const result = await QualityRetryHandler.executeWithRetry(
    prompt,
    { qualityConfig: this.qualityAgent.qualityConfig, context },
    {
      generate: async (p, attempt) => {
        const pathParams = {
          type: framePosition === "start" ? "scene_start_frame" : "scene_end_frame",
          sceneId: scene.id,
          attempt
        };
        return await this.executeGenerateImage(p, pathParams, previousFrame, referenceImageUrls);
      },

      evaluate: async (frame, attempt) => {
        return await this.qualityAgent.evaluateFrameQuality(
          frame,
          scene,
          framePosition,
          characters,
          locations
        );
      },

      applyCorrections: async (p, evaluation, attempt) => {
        return await this.qualityAgent.applyQualityCorrections(
          p,
          evaluation,
          scene,
          characters,
          attempt
        );
      },

      calculateScore: (evaluation) => {
        return this.qualityAgent['calculateOverallScore'](evaluation.scores);
      }
    }
  );

  return result.output;
}
```

### 3. **Environment Variable Tuning**

Consider adjusting thresholds based on your quality targets:

```bash
# .env adjustments for more lenient acceptance
ACCEPT_THRESHOLD=0.90           # Was 0.95 - Accept at 90% instead of 95%
MINOR_ISSUE_THRESHOLD=0.85      # Was 0.90 - More room for minor issues
MAJOR_ISSUE_THRESHOLD=0.70      # Keep at 70% - Major issues still trigger retry
FAIL_THRESHOLD=0.70             # Keep at 70%
MAX_RETRIES=3                   # Keep at 3 attempts
SAFETY_RETRIES=2                # Keep at 2 safety retries
```

---

## Debugging Failed Generations

### Pattern: Quality Degrading Across Attempts

**Symptoms**:
```
Attempt 1: 65%
Attempt 2: 58%
Attempt 3: 42%
```

**Diagnosis**:
1. Check prompt lengths: Are they decreasing?
   - If YES → Corrections are removing needed detail
2. Review correction logs: What's being changed?
   - Look for "simplified", "streamlined", "removed"
3. Check generation rules: Are they contradictory?
   - Rules might be conflicting with scene requirements

**Solution**:
- Reset to Attempt 1 prompt
- Add more explicit generation rules
- Consider manual prompt review for this scene type

---

### Pattern: Semantic Misunderstandings

**Symptoms**:
```
Issue: "barrel" rendered as physical pipe
Attempt 2: Same issue persists
Attempt 3: Still physical pipe
```

**Diagnosis**:
1. Check if domain rules are active
2. Review correction - does it add negative constraints?
3. Verify generation rules include semantic clarifications

**Solution**:
```typescript
// Add explicit semantic rule
const semanticRule = `
SURFING TERMINOLOGY CLARIFICATION:
- "Barrel" or "tube" = hollow curved interior of breaking WAVE (liquid water)
- NOT a pipe, NOT a tunnel, NOT a solid structure
- Shows: translucent/reflective water, spray, foam, curved liquid surface
- Character is INSIDE the curved water wall, surfing through it
`;

state.generationRules.push(semanticRule);
```

---

### Pattern: Character Consistency Failures

**Symptoms**:
```
Issue: Character gender wrong
Issue: Wrong number of characters
Issue: Character missing entirely
```

**Diagnosis**:
1. Are reference images being passed correctly?
2. Are character specs explicit enough?
3. Is character count specified with exact numbers?

**Solution**:
```typescript
// Enhance character specs in prompt
const enhancedCharacterSpecs = characters.map(c => `
${c.name} (MANDATORY - must be present):
- Gender: ${c.gender} (IMMUTABLE - cannot change)
- Age: ${c.age} years old
- Physical: ${c.description}
- Distinctive features: ${c.distinctiveFeatures || 'See reference image'}
- Reference image: ${c.referenceImageUrls[0]}
- CRITICAL: Match reference image exactly for facial structure, build, and proportions
`).join('\n');

// Add to generation rules
const characterRule = `
CHARACTER COUNT AND IDENTITY:
- Scene requires exactly ${characters.length} characters: ${characters.map(c => c.name).join(', ')}
- Each character must be visible and individually identifiable in every frame
- Character gender, age, and facial structure are IMMUTABLE across all scenes
- Reference images are ground truth - match exactly
`;
```

---

### Pattern: Motion/Direction Confusion

**Symptoms**:
```
Issue: Running toward camera instead of away
Issue: Characters moving wrong direction
Issue: Spatial logic violations
```

**Diagnosis**:
1. Is camera direction specified from camera POV?
2. Are motion verbs explicit enough?
3. Are spatial relationships clearly defined?

**Solution**:
```typescript
// Add explicit motion/direction rules
const motionRule = `
CAMERA-RELATIVE MOTION AND DIRECTION:
- "Toward camera" = characters approaching viewer, faces visible, growing larger
- "Away from camera" = characters receding, backs visible, growing smaller
- "Left" and "right" = from camera's perspective, NOT character's perspective
- "Into ocean" = moving from dry land toward water, NOT parallel to shoreline
- Motion continuity: Direction specified must be maintained throughout scene
`;

// Enhance scene prompt with spatial anchors
const spatialPrompt = `
SPATIAL SETUP:
- Camera position: [specify exact position]
- Camera facing: [specify exact direction]
- Character starting positions: [list each with coordinates]
- Character ending positions: [list each with coordinates]
- Motion path: From [start] toward [end], [direction] relative to camera
`;
```

---

## Advanced Techniques

### 1. **Prompt Complexity Budget**

Track and limit prompt complexity to prevent overwhelming the model:

```typescript
interface PromptComplexityMetrics {
  characterCount: number;
  locationElementCount: number;
  actionVerbCount: number;
  totalLength: number;
  complexityScore: number;
}

function calculateComplexity(prompt: string, scene: Scene): PromptComplexityMetrics {
  const actionVerbs = prompt.match(/\b(sprint|run|jump|leap|dive|throw|catch|swim|surf|ride)\b/gi) || [];
  const locationElements = (scene.location?.naturalElements?.length || 0) +
                          (scene.location?.manMadeObjects?.length || 0);

  const complexityScore =
    (scene.characters.length * 10) +           // Each character adds complexity
    (locationElements * 5) +                   // Each location element
    (actionVerbs.length * 8) +                 // Each action verb
    (prompt.length / 100);                     // Base length factor

  return {
    characterCount: scene.characters.length,
    locationElementCount: locationElements,
    actionVerbCount: actionVerbs.length,
    totalLength: prompt.length,
    complexityScore
  };
}

// Use to warn when scene is too complex
function validateSceneComplexity(scene: Scene, prompt: string): string[] {
  const warnings: string[] = [];
  const metrics = calculateComplexity(prompt, scene);

  if (metrics.complexityScore > 200) {
    warnings.push(`Scene complexity very high (${metrics.complexityScore}). Consider simplifying.`);
  }

  if (metrics.characterCount > 5) {
    warnings.push(`${metrics.characterCount} characters may be difficult to maintain consistently.`);
  }

  if (metrics.actionVerbCount > 8) {
    warnings.push(`${metrics.actionVerbCount} distinct actions may be too complex for single scene.`);
  }

  return warnings;
}
```

### 2. **Reference Image Quality Validation**

Validate that reference images meet quality standards:

```typescript
interface ImageQualityMetrics {
  resolution: { width: number; height: number };
  aspectRatio: number;
  fileSize: number;
  estimatedClarity: 'high' | 'medium' | 'low';
}

async function validateReferenceImage(imageUrl: string): Promise<{
  valid: boolean;
  issues: string[];
  metrics: ImageQualityMetrics;
}> {
  const issues: string[] = [];

  // Check resolution (pseudo-code - use actual image library)
  const metrics = await getImageMetrics(imageUrl);

  if (metrics.resolution.width < 512 || metrics.resolution.height < 512) {
    issues.push(`Resolution too low: ${metrics.resolution.width}x${metrics.resolution.height}`);
  }

  if (metrics.fileSize < 50000) {
    issues.push(`File size too small (${metrics.fileSize} bytes) - may be low quality`);
  }

  const aspectRatio = metrics.resolution.width / metrics.resolution.height;
  if (aspectRatio < 0.5 || aspectRatio > 2.0) {
    issues.push(`Unusual aspect ratio: ${aspectRatio.toFixed(2)}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    metrics
  };
}
```

### 3. **Correction Pattern Learning**

Track which correction patterns work:

```typescript
interface CorrectionPattern {
  issueType: string;
  correctionApplied: string;
  qualityBefore: number;
  qualityAfter: number;
  successful: boolean;
  sceneContext: string;
}

class CorrectionPatternTracker {
  private patterns: CorrectionPattern[] = [];
  private maxAge = 24 * 60 * 60 * 1000; // 24 hours

  recordCorrection(
    issueType: string,
    correction: string,
    before: number,
    after: number,
    scene: Scene
  ) {
    this.patterns.push({
      issueType,
      correctionApplied: correction,
      qualityBefore: before,
      qualityAfter: after,
      successful: after > before,
      sceneContext: scene.description
    });
  }

  getSuccessfulPatterns(issueType: string): CorrectionPattern[] {
    return this.patterns
      .filter(p => p.issueType === issueType && p.successful)
      .sort((a, b) => (b.qualityAfter - b.qualityBefore) - (a.qualityAfter - a.qualityBefore));
  }

  suggestCorrection(issueType: string): string | null {
    const successful = this.getSuccessfulPatterns(issueType);
    if (successful.length === 0) return null;

    // Return most effective correction pattern
    return successful[0].correctionApplied;
  }

  getEffectivenessReport(): string {
    const byType = this.patterns.reduce((acc, p) => {
      if (!acc[p.issueType]) {
        acc[p.issueType] = { total: 0, successful: 0, avgImprovement: 0 };
      }
      acc[p.issueType].total++;
      if (p.successful) {
        acc[p.issueType].successful++;
        acc[p.issueType].avgImprovement += (p.qualityAfter - p.qualityBefore);
      }
      return acc;
    }, {} as Record<string, { total: number; successful: number; avgImprovement: number }>);

    return Object.entries(byType)
      .map(([type, stats]) => {
        const successRate = (stats.successful / stats.total * 100).toFixed(1);
        const avgImprovement = (stats.avgImprovement / stats.successful * 100).toFixed(1);
        return `${type}: ${successRate}% success rate, avg +${avgImprovement}% improvement`;
      })
      .join('\n');
  }
}

// Usage
const correctionTracker = new CorrectionPatternTracker();

// After each correction attempt
correctionTracker.recordCorrection(
  'character_count_mismatch',
  'Added explicit enumeration with visual anchors',
  0.625,
  0.920,
  scene
);

// Before applying correction
const suggestedCorrection = correctionTracker.suggestCorrection('character_count_mismatch');
if (suggestedCorrection) {
  console.log(`💡 Suggested correction based on past success: ${suggestedCorrection}`);
}
```

### 4. **Multi-Attempt Strategy Selection**

Choose retry strategy based on first attempt results:

```typescript
type RetryStrategy = 'conservative' | 'aggressive' | 'reset';

function selectRetryStrategy(
  attempt: number,
  currentScore: number,
  previousScore: number | null,
  evaluation: QualityEvaluationResult
): RetryStrategy {
  // If first attempt and close to threshold, be conservative
  if (attempt === 1 && currentScore >= 0.80) {
    return 'conservative'; // Small, targeted corrections only
  }

  // If quality improved, continue current strategy
  if (previousScore && currentScore > previousScore) {
    return 'conservative'; // What we're doing is working
  }

  // If quality degraded, reset to original
  if (previousScore && currentScore < previousScore - 0.05) {
    return 'reset'; // Corrections made it worse, start over
  }

  // If stuck at low quality, try aggressive changes
  if (attempt > 1 && currentScore < 0.70) {
    return 'aggressive'; // Need major changes
  }

  return 'conservative'; // Default
}

// Apply strategy
async function applyCorrectionsWithStrategy(
  strategy: RetryStrategy,
  originalPrompt: string,
  currentPrompt: string,
  evaluation: QualityEvaluationResult
): Promise<string> {
  switch (strategy) {
    case 'reset':
      console.log('   🔄 RESET strategy: Reverting to original prompt with targeted fix');
      // Start from original, apply only the most critical correction
      const criticalIssues = evaluation.issues.filter(i => i.severity === 'critical');
      if (criticalIssues.length > 0) {
        const criticalCorrections = evaluation.promptCorrections?.filter(
          c => criticalIssues.some(i => i.category === c.category)
        );
        return await applyCorrections(originalPrompt, criticalCorrections || []);
      }
      return originalPrompt;

    case 'conservative':
      console.log('   🎯 CONSERVATIVE strategy: Applying targeted corrections only');
      // Apply only critical and major issue corrections
      const importantCorrections = evaluation.promptCorrections?.filter(
        c => evaluation.issues.some(i =>
          (i.severity === 'critical' || i.severity === 'major') &&
          i.category === c.category
        )
      );
      return await applyCorrections(currentPrompt, importantCorrections || []);

    case 'aggressive':
      console.log('   ⚡ AGGRESSIVE strategy: Applying all corrections with enhancements');
      // Apply all corrections plus add extra detail
      return await applyCorrections(currentPrompt, evaluation.promptCorrections || [], {
        addExtraDetail: true,
        addNegativeConstraints: true
      });
  }
}
```

---

## Monitoring & Alerting

### Quality Threshold Alerts

Set up alerts for quality issues:

```typescript
interface QualityAlert {
  severity: 'warning' | 'error' | 'critical';
  message: string;
  sceneId: number;
  attempt: number;
  score: number;
  recommendation: string;
}

function checkQualityAlerts(
  scene: Scene,
  attempt: number,
  score: number,
  previousScores: number[]
): QualityAlert[] {
  const alerts: QualityAlert[] = [];

  // Alert: Consistent decline
  if (previousScores.length >= 2) {
    const declining = previousScores.every((s, i) =>
      i === 0 || s < previousScores[i - 1]
    );
    if (declining) {
      alerts.push({
        severity: 'error',
        message: 'Quality consistently declining across attempts',
        sceneId: scene.id,
        attempt,
        score,
        recommendation: 'Consider resetting to attempt 1 prompt or reviewing correction strategy'
      });
    }
  }

  // Alert: Far from threshold
  if (attempt === 3 && score < 0.70) {
    alerts.push({
      severity: 'critical',
      message: 'Final attempt still below acceptable threshold',
      sceneId: scene.id,
      attempt,
      score,
      recommendation: 'Scene may require manual prompt authoring or scene simplification'
    });
  }

  // Alert: Stuck at same score
  if (previousScores.length >= 2 &&
      Math.abs(score - previousScores[previousScores.length - 1]) < 0.02) {
    alerts.push({
      severity: 'warning',
      message: 'Quality not improving despite corrections',
      sceneId: scene.id,
      attempt,
      score,
      recommendation: 'Corrections may not be addressing root issues. Review evaluation details.'
    });
  }

  return alerts;
}

// Usage
const alerts = checkQualityAlerts(scene, attempt, score, previousScores);
alerts.forEach(alert => {
  const icon = alert.severity === 'critical' ? '🚨' :
               alert.severity === 'error' ? '❌' : '⚠️';
  console.log(`\n${icon} QUALITY ALERT: ${alert.message}`);
  console.log(`   💡 Recommendation: ${alert.recommendation}`);
});
```

---

## Persistence of Evaluation Results

**Crucial Update**: All evaluation results generated by the `QualityCheckAgent` (including scores, departmental issues, and suggested prompt corrections) are now serialized and persisted as part of the scene object within the **LangGraph State Checkpoint** in PostgreSQL.

This means:
1.  **History is Durable**: Evaluation attempts are no longer lost if the process restarts.
2.  **Retry Context**: When a `RETRY_SCENE` command is processed, the worker loads the *entire history* for that scene from the checkpoint, allowing the `CorrectionPatternTracker` logic (see Advanced Techniques) to make data-informed decisions on which correction strategy to apply (conservative, aggressive, or reset).
3.  **Global Metrics Calculation**: Workflow metrics (like `averageFinalScore`) calculated across multiple runs can now be accurately aggregated from the stored scene metrics within the persisted state objects.

---

## Performance Optimization

### 1. **Parallel Evaluation for Multiple Scenes**

```typescript
// Instead of sequential
for (const scene of scenes) {
  await generateScene(scene);
}

// Use controlled parallelism
const CONCURRENT_GENERATIONS = 3;

async function generateScenesInParallel(scenes: Scene[]): Promise<GeneratedScene[]> {
  const results: GeneratedScene[] = [];

  for (let i = 0; i < scenes.length; i += CONCURRENT_GENERATIONS) {
    const batch = scenes.slice(i, i + CONCURRENT_GENERATIONS);
    const batchResults = await Promise.all(
      batch.map(scene => generateScene(scene))
    );
    results.push(...batchResults);

    // Rate limiting between batches
    if (i + CONCURRENT_GENERATIONS < scenes.length) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  return results;
}
```

### 2. **Cache Successful Prompts**

```typescript
interface PromptCacheEntry {
  sceneSignature: string;  // Hash of scene characteristics
  prompt: string;
  score: number;
  timestamp: number;
}

class PromptCache {
  private cache: Map<string, PromptCacheEntry> = new Map();
  private maxAge = 24 * 60 * 60 * 1000; // 24 hours

  getSceneSignature(scene: Scene): string {
    // Create hash of scene characteristics
    return `${scene.shotType}_${scene.cameraMovement}_${scene.characters.length}_${scene.duration}`;
  }

  get(scene: Scene): string | null {
    const signature = this.getSceneSignature(scene);
    const entry = this.cache.get(signature);

    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(signature);
      return null;
    }

    console.log(`   💾 Using cached prompt (score: ${(entry.score * 100).toFixed(1)}%)`);
    return entry.prompt;
  }

  set(scene: Scene, prompt: string, score: number) {
    const signature = this.getSceneSignature(scene);
    this.cache.set(signature, {
      sceneSignature: signature,
      prompt,
      score,
      timestamp: Date.now()
    });
  }

  getStats(): { size: number; avgScore: number } {
    const entries = Array.from(this.cache.values());
    const avgScore = entries.reduce((sum, e) => sum + e.score, 0) / entries.length;
    return { size: entries.length, avgScore };
  }
}

// Usage
const promptCache = new PromptCache();

// Before generating prompt
if (!promptCache.get(scene)) {
    const prompt = await generatePromptForScene(scene);
    promptCache.set(scene, prompt, 0.90); // Cache with initial high score if passed inspection, or use lowest score achieved
}

// Before applying correction
const cachedPrompt = promptCache.get(scene);
if (cachedPrompt) {
    // Use cached prompt and skip generation if score is acceptable
}
```

---

## Success Metrics

Track these KPIs to measure improvement:

```typescript
interface QualityKPIs {
  // Attempt metrics
  firstAttemptSuccessRate: number;      // % of scenes accepted on attempt 1
  averageAttemptsPerScene: number;       // Lower is better
  retrySuccessRate: number;              // % of retries that improve quality

  // Score metrics
  averageFirstAttemptScore: number;      // Higher is better
  averageFinalScore: number;             // Higher is better
  scoreImprovementRate: number;          // (final - first) / first

  // Issue metrics
  criticalIssuesPerScene: number;        // Lower is better
  semanticMisunderstandingRate: number;  // % scenes with semantic issues
  characterConsistencyRate: number;      // % scenes with character issues

  // Efficiency metrics
  totalGenerationTime: number;           // Minutes
  wastedGenerations: number;             // Attempts that didn't improve quality
  promptCorrectionEffectiveness: number; // % corrections that improved quality
}

function calculateKPIs(metrics: SceneGenerationMetric[]): QualityKPIs {
  const firstAttemptSuccesses = metrics.filter(m => m.bestAttempt === 1).length;
  const totalScenes = metrics.length;

  const firstScores = metrics.map(m => m.firstAttemptScore || 0);
  const finalScores = metrics.map(m => m.finalScore);

  return {
    firstAttemptSuccessRate: firstAttemptSuccesses / totalScenes,
    averageAttemptsPerScene: metrics.reduce((sum, m) => sum + m.attempts, 0) / totalScenes,
    retrySuccessRate: calculateRetrySuccessRate(metrics),

    averageFirstAttemptScore: average(firstScores),
    averageFinalScore: average(finalScores),
    scoreImprovementRate: calculateAverageImprovement(firstScores, finalScores),

    criticalIssuesPerScene: calculateAverageCriticalIssues(metrics),
    semanticMisunderstandingRate: calculateSemanticRate(metrics),
    characterConsistencyRate: calculateCharacterRate(metrics),

    totalGenerationTime: metrics.reduce((sum, m) => sum + (m.duration || 0), 0),
    wastedGenerations: calculateWastedGenerations(metrics),
    promptCorrectionEffectiveness: calculateCorrectionEffectiveness(metrics)
  };
}

// Target KPIs (goals)
const TARGET_KPIS: QualityKPIs = {
  firstAttemptSuccessRate: 0.70,           // 70% success on first try
  averageAttemptsPerScene: 1.5,            // Average 1.5 attempts per scene
  retrySuccessRate: 0.80,                  // 80% of retries improve quality

  averageFirstAttemptScore: 0.85,          // Average 85% on first attempt
  averageFinalScore: 0.92,                 // Average 92% final score
  scoreImprovementRate: 0.10,              // 10% improvement from first to final

  criticalIssuesPerScene: 0.2,             // 0.2 critical issues per scene
  semanticMisunderstandingRate: 0.05,      // 5% semantic errors
  characterConsistencyRate: 0.90,          // 90% character consistency

  totalGenerationTime: 60,                 // 60 minutes total
  wastedGenerations: 5,                    // Only 5 wasted attempts total
  promptCorrectionEffectiveness: 0.75      // 75% of corrections help
};
```

---

## Conclusion

These best practices and additional suggestions provide:

1.  **Quick wins** you can implement immediately (Rulesets, Retry Handler integration).
2.  **Debugging patterns** for common failure modes.
3.  **Advanced techniques** for continuous improvement (Complexity Budget, Caching).
4.  **Monitoring** to track effectiveness via KPIs.
5.  **Persistence Guarantee**: Evaluation results are now **checkpointed in PostgreSQL**, ensuring durability and enabling full replayability for retry commands.

Start with the quick wins, monitor the results, and gradually implement the advanced techniques as needed.
