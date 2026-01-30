// src/pipeline/utils/retry-logger.ts
/**
 * Comprehensive retry logging utility for quality control processes
 */

import { QualityEvaluationResult, PromptCorrection, AssetKey } from "../types/index.js";

export interface RetryContext {
  assetKey: AssetKey;
  sceneId: string;
  sceneIndex: number;
  attempt: number;
  maxAttempts: number;
  framePosition?: 'start' | 'end';
  projectId: string;
}

export class RetryLogger {

  /**
   * Log the start of a generation attempt
   */
  static logAttemptStart(context: RetryContext, promptLength: number): void {
    const { assetKey, sceneId, attempt, maxAttempts, framePosition } = context;
    const frameLabel = framePosition ? ` (${framePosition})` : '';

    console.log(`\n${'='.repeat(70)}`);
    console.log(`🎯 ${assetKey}${frameLabel} GENERATION - Scene ${sceneId}`);
    console.log(`   Attempt: ${attempt}/${maxAttempts}`);
    console.log(`   Prompt length: ${promptLength} characters`);
    console.log(`${'='.repeat(70)}`);
  }

  /**
   * Log evaluation results with detailed breakdown
   */
  static logEvaluationDetails(
    context: RetryContext,
    evaluation: QualityEvaluationResult,
    score: number
  ): void {
    const scorePercent = (score * 100).toFixed(1);
    const icon = this.getScoreIcon(score);

    console.log(`\n📊 EVALUATION RESULTS - Attempt ${context.attempt}`);
    console.log(`   ${icon} Overall Score: ${scorePercent}% (${evaluation.grade})`);
    console.log(`   ${'─'.repeat(60)}`);

    // Log dimension-by-dimension breakdown
    console.log(`   📋 Dimension Breakdown:`);
    Object.entries(evaluation.scores).forEach(([ dimension, score ]) => {
      const dimIcon = this.getRatingIcon(score.rating);
      const weight = `(${(score.weight * 100).toFixed(0)}% weight)`;
      console.log(`      ${dimIcon} ${this.formatDimensionName(dimension)}: ${score.rating} ${weight}`);
      if (score.details) {
        console.log(`         └─ ${score.details}`);
      }
    });

    // Log issues grouped by severity
    if (evaluation.issues.length > 0) {
      console.log(`\n   🔍 ISSUES IDENTIFIED (${evaluation.issues.length} total):`);

      const criticalIssues = evaluation.issues.filter(i => i.severity === 'critical');
      const majorIssues = evaluation.issues.filter(i => i.severity === 'major');
      const minorIssues = evaluation.issues.filter(i => i.severity === 'minor');

      if (criticalIssues.length > 0) {
        console.log(`\n      🚨 CRITICAL (${criticalIssues.length}):`);
        criticalIssues.forEach((issue, i) => {
          console.log(`         ${i + 1}. [${issue.department}/${issue.category}]`);
          console.log(`            ${issue.description}`);
          if (issue.suggestedFix) {
            console.log(`            💡 Suggested fix: ${issue.suggestedFix}`);
          }
        });
      }

      if (majorIssues.length > 0) {
        console.log(`\n      ⚠️  MAJOR (${majorIssues.length}):`);
        majorIssues.forEach((issue, i) => {
          console.log(`         ${i + 1}. [${issue.department}/${issue.category}]`);
          console.log(`            ${issue.description}`);
          if (issue.suggestedFix) {
            console.log(`            💡 Suggested fix: ${issue.suggestedFix}`);
          }
        });
      }

      if (minorIssues.length > 0) {
        console.log(`\n      ℹ️  MINOR (${minorIssues.length}):`);
        minorIssues.forEach((issue, i) => {
          console.log(`         ${i + 1}. [${issue.department}/${issue.category}] ${issue.description}`);
        });
      }
    }

    console.log(`   ${'─'.repeat(60)}`);
  }

  /**
   * Log prompt correction details
   */
  static logPromptCorrections(
    context: RetryContext,
    corrections: PromptCorrection[],
    originalLength: number,
    correctedLength: number
  ): void {
    console.log(`\n🔧 APPLYING PROMPT CORRECTIONS - Attempt ${context.attempt} → ${context.attempt + 1}`);
    console.log(`   Corrections to apply: ${corrections.length}`);
    console.log(`   Prompt length change: ${originalLength} → ${correctedLength} chars (${this.formatLengthChange(originalLength, correctedLength)})`);

    if (corrections.length > 0) {
      console.log(`\n   📝 Correction Details:`);
      corrections.forEach((correction, i) => {
        console.log(`\n      ${i + 1}. [${correction.department}] ${correction.issueType}`);
        console.log(`         Original: "${this.truncate(correction.originalPromptSection, 80)}"`);
        console.log(`         Corrected: "${this.truncate(correction.correctedPromptSection, 80)}"`);
        console.log(`         Reasoning: ${correction.reasoning}`);
      });
    }

    console.log(`\n   ⏱️  Waiting 3s before retry...`);
  }

  /**
   * Log when using fallback prompt (no corrections available)
   */
  static logFallbackRetry(context: RetryContext, reason: string): void {
    console.log(`\n🔄 RETRY WITHOUT CORRECTIONS - Attempt ${context.attempt} → ${context.attempt + 1}`);
    console.log(`   Reason: ${reason}`);
    console.log(`   Using original prompt with no modifications`);
    console.log(`   ⏱️  Waiting 3s before retry...`);
  }

  /**
   * Log final result after all attempts
   */
  static logFinalResult(
    context: RetryContext,
    bestScore: number,
    acceptThreshold: number,
    totalAttempts: number,
    evaluation?: QualityEvaluationResult
  ): void {
    const bestPercent = (bestScore * 100).toFixed(1);
    const thresholdPercent = (acceptThreshold * 100).toFixed(0);
    const success = bestScore >= acceptThreshold;

    console.log(`\n${'='.repeat(70)}`);
    if (success) {
      console.log(`✅ QUALITY CHECK PASSED - Scene ${context.sceneId}`);
    } else {
      console.log(`⚠️  QUALITY CHECK INCOMPLETE - Scene ${context.sceneId}`);
    }
    console.log(`   Best Score: ${bestPercent}% (threshold: ${thresholdPercent}%)`);
    console.log(`   Total Attempts: ${totalAttempts}/${context.maxAttempts}`);

    if (!success && evaluation) {
      console.log(`\n   🔍 Best Attempt Summary:`);
      const criticalCount = evaluation.issues.filter(i => i.severity === 'critical').length;
      const majorCount = evaluation.issues.filter(i => i.severity === 'major').length;
      const minorCount = evaluation.issues.filter(i => i.severity === 'minor').length;

      console.log(`      Critical issues: ${criticalCount}`);
      console.log(`      Major issues: ${majorCount}`);
      console.log(`      Minor issues: ${minorCount}`);

      if (evaluation.ruleSuggestion) {
        console.log(`\n   💡 Generation Rule Suggested:`);
        console.log(`      "${evaluation.ruleSuggestion}"`);
      }
    }

    console.log(`${'='.repeat(70)}\n`);
  }

  /**
   * Log safety retry information
   */
  static logSafetyRetry(
    context: RetryContext,
    safetyAttempt: number,
    maxSafetyRetries: number,
    errorMessage: string
  ): void {
    console.log(`\n🛡️  SAFETY VIOLATION DETECTED - Scene ${context.sceneId}`);
    console.log(`   Quality Attempt: ${context.attempt}`);
    console.log(`   Safety Retry: ${safetyAttempt}/${maxSafetyRetries}`);
    console.log(`   Error: ${this.truncate(errorMessage, 100)}`);
    console.log(`   Action: Sanitizing prompt and retrying...`);
  }

  /**
   * Log when safety sanitization is applied
   */
  static logPromptSanitized(originalLength: number, sanitizedLength: number): void {
    console.log(`   ✓ Prompt sanitized: ${originalLength} → ${sanitizedLength} chars`);
  }

  /**
   * Log generation rule addition
   */
  static logGenerationRuleAdded(rule: string, totalRules: number): void {
    console.log(`\n📚 GENERATION RULE ADDED (Total: ${totalRules})`);
    console.log(`   "${rule}"`);
  }

  /**
   * Log quality trend information
   */
  static logQualityTrend(
    sceneId: number,
    trendSlope: number,
    generationNumber: number
  ): void {
    const direction = trendSlope > 0.01 ? 'Improving ↗️' :
      trendSlope < -0.01 ? 'Worsening ↘️' :
        'Stable →';

    console.log(`\n📈 LEARNING REPORT (Generation ${generationNumber}):`);
    console.log(`   Quality Trend Slope: ${trendSlope.toFixed(3)} (${direction})`);

    if (trendSlope < -0.01) {
      console.log(`   ⚠️  WARNING: Quality is degrading. Consider:`);
      console.log(`      • Reviewing prompt correction strategy`);
      console.log(`      • Checking if corrections are too aggressive`);
      console.log(`      • Evaluating if baseline prompt needs improvement`);
    }
  }

  // Helper methods

  private static getScoreIcon(score: number): string {
    if (score >= 0.95) return '🌟';
    if (score >= 0.90) return '✅';
    if (score >= 0.70) return '⚠️ ';
    return '❌';
  }

  private static getRatingIcon(rating: string): string {
    switch (rating) {
      case 'PASS': return '✅';
      case 'MINOR_ISSUES': return '⚠️ ';
      case 'MAJOR_ISSUES': return '❌';
      case 'FAIL': return '🚫';
      default: return '❓';
    }
  }

  private static formatDimensionName(dimension: string): string {
    return dimension
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .replace(/^./, str => str.toUpperCase());
  }

  private static formatLengthChange(original: number, corrected: number): string {
    const diff = corrected - original;
    const percent = ((diff / original) * 100).toFixed(1);
    if (diff > 0) return `+${diff} chars, +${percent}%`;
    if (diff < 0) return `${diff} chars, ${percent}%`;
    return 'no change';
  }

  private static truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}
