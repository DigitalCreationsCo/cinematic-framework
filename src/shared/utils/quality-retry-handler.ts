// src/pipeline/utils/quality-retry-handler.ts
/**
 * Unified retry handler for quality-controlled generation
 * Eliminates code duplication between frame and scene generation
 */

import { GetAttemptMetricCallback } from "../types/pipeline.types.js";
import { QualityEvaluationResult, QualityConfig, Scene } from "../types/index.js";
import { RetryLogger, RetryContext } from "./retry-logger.js";



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

export type GenerateCallbackProps<T> = [
  prompt: string,
  attempt: number,
];
export type EvaluateCallbackProps<T> = [
  output: T, attempt: number
];
export type ApplyCorrectionsCallbackProps<T> = [
  prompt: string,
  evaluation: QualityEvaluationResult,
  attempt: number,
];
export type CalculateScoreProps = [ evaluation: QualityEvaluationResult ];

export interface GenerationCallbacks<T> {
  generate: (...args: GenerateCallbackProps<T>) => Promise<T>;
  evaluate: (...args: EvaluateCallbackProps<T>) => Promise<QualityEvaluationResult>;
  applyCorrections: (...args: ApplyCorrectionsCallbackProps<T>) => Promise<string>;
  calculateScore: (...args: CalculateScoreProps) => number;
  onComplete?: GetAttemptMetricCallback;
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
    prompt: string,
    config: QualityRetryConfig,
    callbacks: GenerationCallbacks<T>
  ): Promise<QualityRetryResult<T>> {

    const { qualityConfig, context } = config;
    const acceptanceThreshold = qualityConfig.minorIssueThreshold;

    const { generate, evaluate, applyCorrections, calculateScore, onComplete } = callbacks;

    let bestOutput: T | null = null;
    let bestEvaluation: QualityEvaluationResult | null = null;
    let bestScore = 0;
    let currentPrompt = prompt;
    let totalAttempts = 0;

    for (let attempt = 1; attempt <= qualityConfig.maxRetries; attempt++) {

      totalAttempts = attempt;
      const attemptContext: RetryContext = { ...context, attempt };
      try {

        RetryLogger.logAttemptStart(attemptContext, currentPrompt.length);

        const output = await generate(currentPrompt, attempt);

        const evaluation = await evaluate(output, attempt);
        const score = calculateScore(evaluation);
        RetryLogger.logEvaluationDetails(attemptContext, evaluation, score);

        if (score > bestScore) {
          bestScore = score;
          bestOutput = output;
          bestEvaluation = evaluation;
        }

        if (score >= acceptanceThreshold) {
          console.log(`   ✅ Quality acceptable (${(score * 100).toFixed(1)}%)`);
          RetryLogger.logFinalResult(attemptContext, score, acceptanceThreshold, totalAttempts);

          // if (onComplete) {
          //   onComplete(output, {
          //     attemptNumber: attempt,
          //     finalScore: bestScore,
          //     ruleAdded: bestEvaluation?.promptCorrections?.map(c => c.correctedPromptSection)!,
          //     assetVersion: attempt,
          //     corrections: bestEvaluation?.promptCorrections!,
          //   });
          // }
          return {
            output,
            evaluation,
            attempts: totalAttempts,
            finalScore: score
          };
        }

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
        await new Promise(resolve => setTimeout(resolve, 3000));

      } catch (error) {
        console.error(`   ✗ Attempt ${attempt} failed:`, error);
        if (attempt < qualityConfig.maxRetries) {
          console.log(`   Retrying generation...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    if (bestOutput && bestScore > 0) {
      RetryLogger.logFinalResult(
        { ...context, attempt: totalAttempts },
        bestScore,
        acceptanceThreshold,
        totalAttempts,
        bestEvaluation!
      );

      const scorePercent = (bestScore * 100).toFixed(1);
      const thresholdPercent = (acceptanceThreshold * 100).toFixed(0);
      console.warn(`   ⚠️  Using best attempt: ${scorePercent}% (threshold: ${thresholdPercent}%)`);

      return {
        output: bestOutput,
        evaluation: bestEvaluation!,
        attempts: totalAttempts,
        finalScore: bestScore,
        warning: `Quality below threshold after ${totalAttempts} attempts`
      };
    }

    throw new Error(`Failed to generate acceptable ${context.assetKey} after ${totalAttempts} attempts`);
  }
}
