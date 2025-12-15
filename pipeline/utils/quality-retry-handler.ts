/**
 * Unified retry handler for quality-controlled generation
 * Eliminates code duplication between frame and scene generation
 */

import { QualityEvaluationResult, QualityConfig } from "../../shared/pipeline-types";
import { RetryLogger, RetryContext } from "./retry-logger";

export interface QualityRetryConfig {
  qualityConfig: QualityConfig;
  context: RetryContext;
}

export interface GenerationResult<T> {
  output: T;
  evaluation: QualityEvaluationResult;
  score: number;
}

export interface QualityRetryResult<T> {
  output: T;
  evaluation: QualityEvaluationResult;
  attempts: number;
  finalScore: number;
  warning?: string;
}

export interface GenerationCallbacks<T> {
  generate: (prompt: string, attempt: number) => Promise<T>;
  evaluate: (output: T, attempt: number) => Promise<QualityEvaluationResult>;
  applyCorrections: (
    prompt: string,
    evaluation: QualityEvaluationResult,
    attempt: number
  ) => Promise<string>;
  calculateScore: (evaluation: QualityEvaluationResult) => number;
}

/**
 * Unified quality retry handler
 * Handles retry logic, logging, and best-attempt tracking for any generation type
 */
export class QualityRetryHandler {

  /**
   * Execute generation with quality-based retry logic
   */
  static async executeWithRetry<T>(
    initialPrompt: string,
    config: QualityRetryConfig,
    callbacks: GenerationCallbacks<T>
  ): Promise<QualityRetryResult<T>> {

    const { qualityConfig, context } = config;
    const { generate, evaluate, applyCorrections, calculateScore } = callbacks;

    let bestOutput: T | null = null;
    let bestEvaluation: QualityEvaluationResult | null = null;
    let bestScore = 0;
    let currentPrompt = initialPrompt;
    let totalAttempts = 0;

    for (let attempt = 1; attempt <= qualityConfig.maxRetries; attempt++) {
      totalAttempts = attempt;
      const attemptContext: RetryContext = { ...context, attempt };

      try {
        // Log attempt start
        RetryLogger.logAttemptStart(attemptContext, currentPrompt.length);

        // Generate
        const output = await generate(currentPrompt, attempt);

        // Evaluate
        const evaluation = await evaluate(output, attempt);
        const score = calculateScore(evaluation);

        // Log evaluation details
        RetryLogger.logEvaluationDetails(attemptContext, evaluation, score);

        // Track best attempt
        if (score > bestScore) {
          bestScore = score;
          bestOutput = output;
          bestEvaluation = evaluation;
        }

        // Check if quality is acceptable
        if (score >= qualityConfig.minorIssueThreshold) {
          console.log(`   ✅ Quality acceptable (${(score * 100).toFixed(1)}%)`);
          RetryLogger.logFinalResult(attemptContext, score, qualityConfig.acceptThreshold, totalAttempts);

          return {
            output,
            evaluation,
            attempts: totalAttempts,
            finalScore: score
          };
        }

        // If this was the last attempt, break without retrying
        if (attempt >= qualityConfig.maxRetries) {
          break;
        }

        // Apply corrections for next attempt
        if (evaluation.promptCorrections && evaluation.promptCorrections.length > 0) {
          const originalLength = currentPrompt.length;
          currentPrompt = await applyCorrections(currentPrompt, evaluation, attempt);
          RetryLogger.logPromptCorrections(
            attemptContext,
            evaluation.promptCorrections,
            originalLength,
            currentPrompt.length
          );
        } else {
          RetryLogger.logFallbackRetry(
            attemptContext,
            'No prompt corrections provided by evaluation'
          );
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 3000));

      } catch (error) {
        console.error(`   ✗ Attempt ${attempt} failed:`, error);

        // If we have partial results, consider them for best-attempt tracking
        // (This would require passing output/evaluation through the error, which we skip for now)

        if (attempt < qualityConfig.maxRetries) {
          console.log(`   Retrying generation...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    // All attempts exhausted - return best attempt
    if (bestOutput && bestScore > 0) {
      RetryLogger.logFinalResult(
        { ...context, attempt: totalAttempts },
        bestScore,
        qualityConfig.acceptThreshold,
        totalAttempts,
        bestEvaluation!
      );

      const scorePercent = (bestScore * 100).toFixed(1);
      const thresholdPercent = (qualityConfig.acceptThreshold * 100).toFixed(0);
      console.warn(`   ⚠️  Using best attempt: ${scorePercent}% (threshold: ${thresholdPercent}%)`);

      return {
        output: bestOutput,
        evaluation: bestEvaluation!,
        attempts: totalAttempts,
        finalScore: bestScore,
        warning: `Quality below threshold after ${totalAttempts} attempts`
      };
    }

    throw new Error(`Failed to generate acceptable ${context.type} after ${totalAttempts} attempts`);
  }
}
