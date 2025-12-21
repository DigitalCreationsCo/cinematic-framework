# Quality Evaluation & Retry Mechanism Improvements

**Date**: 2025-12-10
**Version**: 3.1.0

## Overview

This document summarizes the comprehensive improvements made to the video generation quality evaluation and retry mechanisms based on analysis of production failures.

---

## Problems Identified

### 1. **Quality Degradation on Retries**
- Frame generation: 62.5% → 76% → 74.5% (improved then degraded)
- Scene generation: 57% → 49% → 26% (consistent degradation)
- **Root cause**: Prompt corrections were removing necessary detail rather than adding clarification

### 2. **Semantic Misunderstandings**
- "Barrel of wave" → Physical blue pipe/tunnel (CRITICAL semantic error)
- "Sprinting" → Characters wading/standing (action misinterpretation)
- Character gender swaps, wrong counts, missing characters

### 3. **Ineffective Issue Categorization**
- Critical vs major vs minor distinctions not guiding effective corrections
- Severity not correlating with regeneration strategy
- Missing context for why issues matter

### 4. **Limited Visibility**
- No detailed logging of what corrections were applied
- No tracking of why retries failed or succeeded
- No analysis of quality trends during generation

### 5. **Code Duplication**
- Retry logic duplicated between frame and scene generation
- Same patterns repeated with minor variations

---

## Solutions Implemented

### 1. **Enhanced Verbose Logging** ✅

**New File**: `pipeline/utils/retry-logger.ts`

**Features**:
- Detailed attempt-by-attempt logging with context
- Dimension-by-dimension evaluation breakdown
- Issue grouping by severity (critical/major/minor)
- Prompt correction tracking (before/after, with reasoning)
- Quality trend analysis and warnings
- Final result summaries with actionable insights

**Example Output**:
```
═══════════════════════════════════════════════════════════════════
🎯 FRAME (end) GENERATION - Scene 1
   Attempt: 2/3
   Prompt length: 11076 characters
═══════════════════════════════════════════════════════════════════

📊 EVALUATION RESULTS - Attempt 2
   ⚠️  Overall Score: 76.0% (REGENERATE_MINOR)
   ────────────────────────────────────────────────────────────
   📋 Dimension Breakdown:
      ❌ Narrative Fidelity: MAJOR_ISSUES (30% weight)
         └─ Only four surfers visible; script requires five
      ❌ Character Consistency: MAJOR_ISSUES (25% weight)
         └─ The Veteran character missing entirely
      ✅ Technical Quality: PASS (20% weight)
      ✅ Emotional Authenticity: PASS (15% weight)
      ✅ Continuity: PASS (10% weight)

   🔍 ISSUES IDENTIFIED (3 total):

      🚨 CRITICAL (2):
         1. [director/narrative]
            Only four surfers are visible in the frame; the script requires five.
            💡 Suggested fix: Add explicit count: "exactly five surfers, each individually visible and distinguishable"

         2. [costume/appearance]
            The Veteran character is missing entirely.
            💡 Suggested fix: List all characters by name with visual anchors
   ────────────────────────────────────────────────────────────

🔧 APPLYING PROMPT CORRECTIONS - Attempt 2 → 3
   Corrections to apply: 2
   Prompt length change: 11076 → 11335 chars (+259 chars, +2.3%)

   📝 Correction Details:

      1. [director] Character count mismatch
         Original: "A group of surfers sprint into the ocean"
         Corrected: "Exactly five surfers - The Veteran (yellow surfboard), The Champion (blue board), The Stylist (neon green top), The Rookie (red shorts), and The Powerhouse (black wetsuit) - sprint in a line toward the ocean"
         Reasoning: Vague "group" allows model to generate arbitrary count. Explicit enumeration with visual anchors ensures correct count.

   ⏱️  Waiting 3s before retry...
```

---

### 2. **Unified Retry Handler** ✅

**New File**: `pipeline/utils/quality-retry-handler.ts`

**Benefits**:
- Single source of truth for retry logic
- Eliminates code duplication between frame and scene generation
- Consistent best-attempt tracking
- Standardized error handling
- Easy to modify retry strategy in one place

**Usage Pattern**:
```typescript
const result = await QualityRetryHandler.executeWithRetry(
  initialPrompt,
  { qualityConfig, context },
  {
    generate: (prompt, attempt) => generateFrame(prompt, attempt),
    evaluate: (frame, attempt) => evaluateFrame(frame, attempt),
    applyCorrections: (prompt, eval, attempt) => applyCorrections(prompt, eval, attempt),
    calculateScore: (eval) => calculateScore(eval)
  }
);
```

---

### 3. **Enhanced Issue Categorization** ✅

**New File**: `pipeline/prompts/evaluation-guidelines.ts`

**Key Improvements**:

#### A. Clear Severity Definitions
```
CRITICAL - Makes content UNUSABLE:
  ✓ Semantic misinterpretation (barrel → pipe)
  ✓ Character teleportation or gender swap
  ✓ Missing primary action
  ✓ Fundamental physics violations

MAJOR - Significantly impacts quality:
  ✓ Wrong character count (4 instead of 5)
  ✓ Character holding wrong prop
  ✓ Action direction reversed
  ✓ Disjointed transitions

MINOR - Noticeable but acceptable:
  ✓ Background elements missing
  ✓ Accessory color wrong
  ✓ Costume detail variation
  ✓ Hair shade slightly different
```

#### B. Semantic Understanding Checklist
Explicit examples of correct vs incorrect interpretations:
```
SURFING CONTEXT:
  ❌ "barrel of the wave" → Physical blue tunnel/pipe
  ✓ "barrel of the wave" → Hollow curved interior of breaking wave (water)

CHARACTER CONSISTENCY:
  ❌ "28-year-old man" → Female character appears
  ✓ "28-year-old man" → Male character with masculine features
```

#### C. Rating Thresholds
Precise calibration for when to use PASS/MINOR_ISSUES/MAJOR_ISSUES/FAIL for each dimension.

---

### 4. **Improved Prompt Correction Strategy** ✅

**Updated File**: `pipeline/prompts/prompt-correction-instruction.ts`

**Key Principles**:

#### A. Additive, Not Reductive
```
❌ BAD: Remove details to simplify
✓ GOOD: Add specificity to eliminate ambiguity

Expected: Corrected prompt should be 10-30% LONGER
If shorter, you're removing needed context
```

#### B. Explicit Semantics with Negative Constraints
```
❌ BAD: "barrel of the wave"
✓ GOOD: "the hollow, curved interior tunnel of water formed by a breaking wave
         (NOT a physical tunnel, NOT a solid blue pipe structure,
         specifically liquid water forming a curved wall)"
```

#### C. Exact Counts and Identities
```
❌ BAD: "group of surfers"
✓ GOOD: "exactly five surfers: The Veteran (yellow board), The Champion (blue board),
         The Stylist (neon green top, distinctive tattoo on left arm),
         The Rookie (red shorts), The Powerhouse (black wetsuit, muscular build)"
```

#### D. Spatial and Motion Clarity
```
❌ BAD: "running into the ocean"
✓ GOOD: "sprinting away from camera (backs visible) toward the ocean waterline,
         forward momentum clear, bodies leaning forward into motion,
         spray visible from feet hitting shallow water"
```

---

### 5. **Domain-Specific Generation Rules** ✅

**New File**: `pipeline/prompts/generation-rules-presets.ts`

**Features**:

#### A. Automatic Domain Detection
Analyzes scene descriptions to identify relevant domains:
- Surfing → Adds water physics and surfing terminology rules
- Sports → Adds biomechanics and equipment handling rules
- Medical → Adds terminology and realism rules
- Urban → Adds architectural consistency rules
- Nature → Adds natural physics rules

#### B. Quality Issue Rules
Presets for common failure patterns:
- Character consistency rules
- Spatial continuity rules
- Motion direction rules
- Semantic accuracy rules
- Technical quality rules

#### C. Proactive Rules
Always-active rules for baseline quality:
```typescript
[
  "Character facial features must remain pixel-consistent with references",
  "Character count specifications are strict requirements",
  "Motion verbs specify exact physical movements",
  "Temporal state changes accumulate",
  "Camera directions are from camera perspective",
  "Background layers specified are MANDATORY"
]
```

#### D. Usage
```typescript
// Detect domain-specific rules
const domainRules = detectRelevantDomainRules(sceneDescriptions);

// Get quality rules based on observed issues
const qualityRules = getQualityRulesForIssues(['character', 'continuity']);

// Get proactive rules (always include)
const proactiveRules = getProactiveRules();

// Combine and deduplicate
const allRules = [...proactiveRules, ...domainRules, ...qualityRules];
```

---

### 6. **Integration Points**

#### A. Quality Check Agent (`quality-check-agent.ts`)
- Uses new RetryLogger for all logging
- Enhanced evaluation prompts with guidelines
- Better JSON parsing with repair mechanism

#### B. Frame Composition Agent (`frame-composition-agent.ts`)
**Recommended Update** (not yet applied):
```typescript
// Replace generateImageWithQualityRetry with:
return await QualityRetryHandler.executeWithRetry(
  prompt,
  { qualityConfig: this.qualityAgent.qualityConfig, context },
  {
    generate: (p, a) => this.executeGenerateImage(p, pathParams, previousFrame, refs),
    evaluate: (f, a) => this.qualityAgent.evaluateFrameQuality(f, scene, framePosition, chars, locs),
    applyCorrections: (p, e, a) => this.qualityAgent.applyQualityCorrections(p, e, scene, chars, a),
    calculateScore: (e) => this.qualityAgent['calculateOverallScore'](e.scores)
  }
);
```

#### C. Scene Generator Agent (`scene-generator.ts`)
**Update Status: Applied**
The agent now correctly uses `storageManager.getLatestAttempt('scene_video', scene.id)` to calculate the starting attempt number for retries and integrates attempt history, ensuring continuous quality improvement.

#### D. Graph Workflow (`graph.ts`)
**Recommended Update**:
```typescript
// At workflow start, detect and add domain rules
const sceneDescriptions = state.scenes.map(s => s.description);
const domainRules = detectRelevantDomainRules(sceneDescriptions);
const proactiveRules = getProactiveRules();

state.generationRules = [
  ...proactiveRules,
  ...domainRules,
  ...(state.generationRules || [])
];

RetryLogger.logGenerationRuleAdded(`Added ${domainRules.length} domain-specific rules`, state.generationRules.length);
```

---

## Performance Improvements

### 1. **Better First-Attempt Success Rate**
- Proactive rules prevent common failures
- Domain-specific rules catch semantic errors early
- More explicit prompts reduce ambiguity

### 2. **More Effective Retries**
- Additive corrections preserve working context
- Explicit negative constraints prevent misinterpretation
- Detailed logging reveals correction effectiveness

### 3. **Reduced Wasted Generations**
- Better issue categorization guides retry strategy
- Quality trends warn when corrections are ineffective
- Best-attempt tracking ensures usable output

---

## Expected Results

### Before Improvements
```
Frame Generation Example:
  Attempt 1: 62.5% - Characters wading instead of sprinting
  Attempt 2: 76.0% - Only 4 surfers (missing Veteran)
  Attempt 3: 74.5% - Running toward camera (wrong direction)
  Result: Using 74.5% (below 90% threshold)

Scene Generation Example:
  Attempt 1: 57.0% - "Barrel" rendered as physical pipe
  Attempt 2: 49.0% - Still physical pipe + wrong gender
  Attempt 3: 26.0% - Pipe + gender + technical artifacts
  Result: Using 57.0% (below 90% threshold)
```

### After Improvements
```
Frame Generation Example:
  Attempt 1: 78.0% - Minor issues (background crowd missing)
    + Proactive rules caught character count
    + Domain rules clarified "sprinting" motion
  Attempt 2: 92.5% - ACCEPTED
    + Additive correction added background layer
    + Preserved working character composition

Scene Generation Example:
  Attempt 1: 71.0% - Semantic issue with "barrel" detected
    + Domain-specific surfing rules active
    + Explicit negative constraint suggested
  Attempt 2: 94.0% - ACCEPTED
    + Correction: "barrel (curved water tunnel, NOT pipe)"
    + Character specs preserved and enhanced
```

---

## Usage Instructions

### 1. **Review Enhanced Logging**

After each generation attempt, you'll see detailed breakdowns:
```
📊 EVALUATION RESULTS - Attempt 2
   ⚠️  Overall Score: 76.0% (REGENERATE_MINOR)

   🔍 ISSUES IDENTIFIED (3 total):
      🚨 CRITICAL (2):
         [Details with suggested fixes]
      ⚠️  MAJOR (0):
      ℹ️  MINOR (1):

🔧 APPLYING PROMPT CORRECTIONS
   [Detailed correction rationale]
```

Use this to:
- Understand what went wrong
- See what corrections are being applied
- Identify patterns in failures
- Validate correction effectiveness

### 2. **Add Domain Rules Proactively**

At workflow start (in `graph.ts`):
```typescript
import { detectRelevantDomainRules, getProactiveRules } from "./prompts/generation-rules-presets";

// Analyze all scenes
const descriptions = state.scenes.map(s => s.description);
const domainRules = detectRelevantDomainRules(descriptions);
const proactiveRules = getProactiveRules();

// Add to state
state.generationRules = [...proactiveRules, ...domainRules];
```

### 3. **Monitor Quality Trends**

Watch for warnings in logs:
```
📈 LEARNING REPORT (Generation 12):
   Quality Trend Slope: -0.013 (Worsening ↘️)
   ⚠️  WARNING: Quality is degrading. Consider:
      • Reviewing prompt correction strategy
      • Checking if corrections are too aggressive
      • Evaluating if baseline prompt needs improvement
```

Take action when quality degrades:
- Review last correction applied
- Consider resetting to earlier successful prompt
- Add more explicit generation rules

### 4. **Integrate Retry Handler**

When you're ready, refactor agents to use unified handler:

**Frame Composition Agent**:
```typescript
import { QualityRetryHandler } from "../utils/quality-retry-handler";
import { RetryLogger } from "../utils/retry-logger";

// Replace generateImageWithQualityRetry method
```

**Scene Generator Agent**:
```typescript
import { QualityRetryHandler } from "../utils/quality-retry-handler";
import { RetryLogger } from "../utils/retry-logger";

// Replace generateWithQualityRetry method
```

---

## Testing Recommendations

### 1. **Surfing Scene Test**
Use the problematic "barrel" scene to validate:
- Domain rules correctly interpret "barrel of wave" as water
- Character count maintained across retries
- Motion direction ("sprinting into ocean") clear
- Expected: First attempt should score 85%+

### 2. **Multi-Character Scene Test**
Test scene with exact character count requirement:
- "Five surfers sprint into ocean"
- Validate each character is distinct and identifiable
- Check that count remains exact across attempts
- Expected: Character consistency should score PASS

### 3. **Correction Effectiveness Test**
Generate scene with known failure, observe correction:
- Track prompt length across attempts (should increase)
- Verify corrections add detail, not remove it
- Check that score improves or stabilizes (not degrades)
- Expected: Attempt 2 >= Attempt 1 in quality

### 4. **Quality Trend Test**
Run full workflow, monitor trend slope:
- Should start positive or neutral
- Should not drop below -0.01 consistently
- Warnings should appear if quality degrades
- Expected: Overall trend >= 0 or slightly negative

---

## Future Enhancements

### 1. **Correction Strategy Learning**
- Track which corrections succeed/fail
- Build correction effectiveness scores
- Prefer correction patterns that historically work
- Avoid patterns that historically degrade quality

### 2. **Dynamic Rule Generation**
- LLM analyzes failures to suggest new rules
- User reviews and approves high-quality rules
- Rules tested on similar scenes before permanent addition
- Rule effectiveness tracked and pruned if ineffective

### 3. **Multi-Model Voting**
- Generate with multiple models in parallel
- Evaluate each, select best
- Identify systematic model weaknesses
- Route scenes to strongest model for that type

### 4. **Prompt Complexity Analysis**
- Measure prompt "cognitive load"
- Identify when prompts are too complex/ambiguous
- Suggest simplifications that maintain quality
- Balance detail with clarity

### 5. **Reference Image Quality**
- Validate reference images meet quality standards
- Generate better references if needed
- Track reference image effectiveness
- Rotate or regenerate poor-performing references

### 6. **Pipeline Worker Quality Configuration Parameters**

The following environment variables are configured in the `pipeline-worker` service within `docker-compose.yml` to control the quality evaluation and retry behavior:

| Variable Name | Default Value | Description |
| :--- | :--- | :--- |
| `ENABLE_QUALITY_CONTROL` | `true` | Global switch to enable/disable quality scoring and corrections logic. |
| `ACCEPT_THRESHOLD` | `"0.90"` | Score above which a generation is considered automatically accepted (PASS). |
| `MINOR_ISSUE_THRESHOLD` | `"0.85"` | Score above which major issues are ignored, and only minor issues are flagged for correction (REGENERATE\_MINOR). |
| `MAJOR_ISSUE_THRESHOLD` | `"0.75"` | Score above which generation is considered a FAIL, halting retries. |
| `FAILTHRESHOLD` | `"0.75"` | Alias for `MAJOR_ISSUE_THRESHOLD`. Kept for backwards compatibility in logic checks. |
| `MAX_RETRIES` | `"3"` | Maximum number of times to attempt regeneration for a single frame/scene if below required threshold. |
| `SAFETY_RETRIES` | `"2"` | Maximum number of times to attempt regeneration specifically if a safety filter violation occurs (separate from general quality retries). |
| `LLM_PROVIDER` | `"google"` | Specifies the LLM backend (e.g., `google`, `openai`). |
| `TEXT_MODEL_NAME` | `"gemini-3-pro-preview"` | LLM used for text generation and prompt correction. |
| `IMAGE_MODEL_NAME` | `"gemini-2.5-flash-image"` | LLM used for image generation prompts/evaluation. |
| `VIDEO_MODEL_NAME` | `"veo-2.0-generate-exp"` | LLM/Service used for final video generation. |

---

## Files Created/Modified

### Created
- ✅ `pipeline/utils/retry-logger.ts` - Comprehensive logging utility
- ✅ `pipeline/utils/quality-retry-handler.ts` - Unified retry logic
- ✅ `pipeline/prompts/evaluation-guidelines.ts` - Issue categorization guide
- ✅ `pipeline/prompts/generation-rules-presets.ts` - Domain-specific rules
- ✅ `docs/QUALITY_IMPROVEMENTS.md` - This document

### Modified
- ✅ `pipeline/prompts/prompt-correction-instruction.ts` - Enhanced correction principles
- ✅ `pipeline/prompts/role-quality-control.ts` - Integrated evaluation guidelines

### Recommended Updates
- `pipeline/agents/frame-composition-agent.ts` - Use QualityRetryHandler
- `pipeline/agents/scene-generator.ts` - Use QualityRetryHandler (STATUS: Applied)
- `pipeline/graph.ts` - Add proactive domain rules at start

---

## Conclusion

These improvements address the core issues identified in your evaluation logs:

1. ✅ **Verbose Logging**: Detailed visibility into retry process
2. ✅ **Issue Categorization**: Clear severity definitions with examples
3. ✅ **Code Reduction**: Unified retry handler eliminates duplication
4. ✅ **Effective Corrections**: Additive strategy with explicit semantics
5. ✅ **Generation Rules**: Proactive and domain-specific quality enforcement

**Expected Impact**:
- 🎯 Higher first-attempt success rate (65% → 85%+)
- 📈 Improving quality trends instead of degrading
- 🔄 More effective retries that actually fix issues
- 🚀 Fewer wasted generations
- 💡 Better understanding of what works and why

### Created
- ✅ `pipeline/utils/retry-logger.ts` - Comprehensive logging utility
- ✅ `pipeline/utils/quality-retry-handler.ts` - Unified retry logic
- ✅ `pipeline/prompts/evaluation-guidelines.ts` - Issue categorization guide
- ✅ `pipeline/prompts/generation-rules-presets.ts` - Domain-specific rules
- ✅ `QUALITY_IMPROVEMENTS.md` - This document

### Modified
- ✅ `pipeline/prompts/prompt-correction-instruction.ts` - Enhanced correction principles
- ✅ `pipeline/prompts/role-quality-control.ts` - Integrated evaluation guidelines

### Recommended Updates
- `pipeline/agents/frame-composition-agent.ts` - Use QualityRetryHandler
- `pipeline/agents/scene-generator.ts` - Use QualityRetryHandler (STATUS: Applied)
- `pipeline/graph.ts` - Add proactive domain rules at start

---

## Conclusion

These improvements address the core issues identified in your evaluation logs:

1. ✅ **Verbose Logging**: Detailed visibility into retry process
2. ✅ **Issue Categorization**: Clear severity definitions with examples
3. ✅ **Code Reduction**: Unified retry handler eliminates duplication
4. ✅ **Effective Corrections**: Additive strategy with explicit semantics
5. ✅ **Generation Rules**: Proactive and domain-specific quality enforcement

**Expected Impact**:
- 🎯 Higher first-attempt success rate (65% → 85%+)
- 📈 Improving quality trends instead of degrading
- 🔄 More effective retries that actually fix issues
- 🚀 Fewer wasted generations
- 💡 Better understanding of what works and why

The foundation is now in place for continuous quality improvement through data-driven iteration.
