
import { Scene, Character, Location, QualityEvaluationResult, PromptCorrection, QualityConfig, QualityEvaluationSchema, zodToJSONSchema, ObjectData } from "../../shared/pipeline-types";
import { GCPStorageManager, GcsObjectPathParams } from "../storage-manager";
import { buildFrameEvaluationPrompt, buildSceneVideoEvaluationPrompt } from "../prompts/evaluation-instruction";
import { buildllmParams } from "../llm/google/llm-params";
import { buildCorrectionPrompt } from "../prompts/prompt-correction-instruction";
import { LlmController } from "../llm/controller";
import { z } from "zod";
import { FileData } from "@google/genai";

const malformedJsonRepairPrompt = (malformedJson: string) => `
The following string is not valid JSON. Please fix it and return only the valid JSON.
Do not include any other text in your response, only the JSON object.
Do not include the markdown characters that denote a a code block.

${malformedJson}
`;

export class QualityCheckAgent {
  private llm: LlmController;
  private storageManager: GCPStorageManager;
  qualityConfig: Readonly<QualityConfig>;

  constructor(
    llm: LlmController,
    storageManager: GCPStorageManager,
    qualityConfig?: Partial<QualityConfig>,
  ) {
    this.llm = llm;
    this.storageManager = storageManager;
    this.qualityConfig = {
      enabled: true,
      acceptThreshold: process.env.ACCEPT_THRESHOLD ? Number(process.env.ACCEPT_THRESHOLD) : 0.95,
      minorIssueThreshold: process.env.MINOR_ISSUE_THRESHOLD ? Number(process.env.MINOR_ISSUE_THRESHOLD) : 0.90,
      majorIssueThreshold: process.env.MAJOR_ISSUE_THRESHOLD ? Number(process.env.MAJOR_ISSUE_THRESHOLD) : 0.7,
      failThreshold: process.env.FAILTHRESHOLD ? Number(process.env.FAILTHRESHOLD) : 0.7,
      maxRetries: process.env.MAX_RETRIES ? Number(process.env.MAX_RETRIES) : 3,
      safetyRetries: process.env.SAFETY_RETRIES ? Number(process.env.SAFETY_RETRIES) : 2,
      ...qualityConfig
    };

    if (isNaN(this.qualityConfig.acceptThreshold)) throw Error('Accept Threshold is not a number');
    if (isNaN(this.qualityConfig.minorIssueThreshold)) throw Error('Minor Issue Threshold is not a number');
    if (isNaN(this.qualityConfig.majorIssueThreshold)) throw Error('Major Issue Threshold is not a number');
    if (isNaN(this.qualityConfig.failThreshold)) throw Error('Fail Threshold is not a number');
    if (isNaN(this.qualityConfig.maxRetries)) throw Error('Max Retries is not a number');
    if (isNaN(this.qualityConfig.safetyRetries)) throw Error('Safety Retries is not a number');
  }

  /**
   * Attempts to parse and validate a JSON string against a Zod schema.
   * If parsing fails, it will try to repair the JSON string using an LLM.
   * @param jsonString The JSON string to parse.
   * @param schema The Zod schema to validate against.
   * @returns The parsed and validated object.
   * @throws An error if parsing, validation, and repair all fail.
   */
  private async parseAndValidateJson<T extends z.ZodTypeAny>(
    jsonString: string,
    schema: T
  ): Promise<z.infer<T>> {
    try {
      // First attempt to parse directly
      return schema.parse(JSON.parse(jsonString));
    } catch (error) {
      console.warn("   ⚠️ Initial JSON parsing failed. Attempting to repair...");

      try {
        // Attempt to repair the JSON using the LLM
        const repairResponse = await this.llm.generateContent(buildllmParams({
          contents: [ { role: "user", parts: [ { text: malformedJsonRepairPrompt(jsonString) } ] } ],
          config: { temperature: 0.1 }
        }));

        if (!repairResponse.text) {
          throw new Error("Failed to repair JSON: LLM returned no text.");
        }

        // Attempt to parse the repaired JSON
        return schema.parse(JSON.parse(repairResponse.text));

      } catch (repairError) {
        console.error("   ✗ JSON repair failed:", repairError);
        // Add original error as cause for better debugging
        throw new Error(`Failed to parse and validate JSON after repair. Original error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async evaluateFrameQuality(
    frame: string,
    scene: Scene,
    framePosition: "start" | "end",
    characters: Character[],
    locations: Location[],
    previousFrameUrl?: FileData
  ): Promise<QualityEvaluationResult> {
    const evaluationPrompt = buildFrameEvaluationPrompt(
      scene,
      frame,
      framePosition,
      QualityEvaluationSchema,
      characters,
      locations,
      previousFrameUrl
    );

    const response = await this.llm.generateContent(buildllmParams({
      contents: [
        {
          role: "user",
          parts: [
            { text: evaluationPrompt },
            {
              fileData: {
                displayName: "frame",
                fileUri: frame,
                mimeType: await this.storageManager.getObjectMimeType(frame) || 'image/png'
              }
            },
            {
              fileData: {
                displayName: "previous frame",
                fileUri: frame,
                mimeType: await this.storageManager.getObjectMimeType(frame) || 'image/png'
              }
            },
          ]
        }
      ],
      config: {
        responseJsonSchema: zodToJSONSchema(QualityEvaluationSchema),
        temperature: 0.3,
      }
    }));

    if (!response.text) {
      throw new Error("No quality evaluation generated from LLM from Quality Check Agent");
    }

    // Use the robust parsing and validation method
    const evaluationData = await this.parseAndValidateJson(response.text, QualityEvaluationSchema);

    const overallScore = this.calculateOverallScore(evaluationData.scores);
    const overallRating = this.determineOverallRating(overallScore);

    const evaluation: QualityEvaluationResult = {
      ...evaluationData,
      overall: overallRating,
    };

    this.logEvaluationResults(scene.id, evaluation, overallScore);
    await this.saveEvaluation({ type: "frame_quality_evaluation", sceneId: scene.id, attempt: 1, framePosition }, evaluation);
    return evaluation;
  }

  /**
   * Perform comprehensive quality check on generated video
   */
  async evaluateScene(
    scene: Scene,
    generatedVideo: ObjectData,
    enhancedPrompt: string,
    characters: Character[],
    location: Location,
    attempt: number,
    previousScene?: Scene,
  ): Promise<QualityEvaluationResult> {
    const evaluationPrompt = buildSceneVideoEvaluationPrompt(
      scene,
      generatedVideo.publicUri,
      enhancedPrompt,
      QualityEvaluationSchema,
      characters,
      location,
      previousScene
    );

    const response = await this.llm.generateContent(buildllmParams({
      contents: [
        {
          role: "user",
          parts: [
            { text: evaluationPrompt },
            {
              fileData: {
                fileUri: generatedVideo.storageUri,
                mimeType: await this.storageManager.getObjectMimeType(generatedVideo.storageUri) || 'video/mp4'
              }
            }
          ]
        }
      ],
      config: {
        responseJsonSchema: zodToJSONSchema(QualityEvaluationSchema),
        temperature: 0.3,
      }
    }));

    if (!response.text) {
      throw new Error("No quality evaluation generated from LLM from Quality Check Agent");
    }

    // Use the robust parsing and validation method
    const evaluationData = await this.parseAndValidateJson(response.text, QualityEvaluationSchema);

    const overallScore = this.calculateOverallScore(evaluationData.scores);
    const overallRating = this.determineOverallRating(overallScore);

    const evaluation: QualityEvaluationResult = {
      ...evaluationData,
      overall: overallRating,
    };

    this.logEvaluationResults(scene.id, evaluation, overallScore);
    await this.saveEvaluation(
      { type: "scene_quality_evaluation", sceneId: scene.id, attempt },
      evaluation
    );
    return evaluation;
  }

  /**
   * Apply prompt corrections and regenerate enhanced prompt
   */
  async applyQualityCorrections(
    originalPrompt: string,
    evaluation: QualityEvaluationResult,
    scene: Scene,
    characters: Character[],
    attempt: number
  ): Promise<string> {

    if (!evaluation.promptCorrections || evaluation.promptCorrections.length === 0) {
      console.log(`   🔄 Attempt ${attempt + 1}: Retrying with original prompt`);
      return originalPrompt;
    }

    console.log(`   🔧 Attempt ${attempt + 1}: Applying ${evaluation.promptCorrections.length} corrections`);

    const correctionPrompt = buildCorrectionPrompt(originalPrompt, scene, evaluation.promptCorrections);

    try {
      const response = await this.llm.generateContent(buildllmParams({
        contents: [ { role: "user", parts: [ { text: correctionPrompt } ] } ],
        config: { temperature: 0.5 }
      }));

      if (!response.text) throw new Error("No correction prompt generated from LLM from Quality Check Agent");

      const correctedPrompt = response.text.trim();

      console.log(`   ✓ Prompt corrected: ${originalPrompt.length} → ${correctedPrompt.length} chars`);

      return correctedPrompt;

    } catch (error) {
      console.error("   ✗ Failed to apply prompt corrections:", error);
      return originalPrompt; // Fallback to original
    }
  }

  /**
   * Calculate weighted overall score
   */
  private calculateOverallScore(scores: QualityEvaluationResult[ "scores" ]): number {
    const ratingToScore = {
      "PASS": 1.0,
      "MINOR_ISSUES": 0.7,
      "MAJOR_ISSUES": 0.4,
      "FAIL": 0.0
    };

    let totalScore = 0;
    let totalWeight = 0;

    for (const key in scores) {
      if (Object.prototype.hasOwnProperty.call(scores, key)) {
        const score = scores[ key as keyof typeof scores ];
        totalScore += ratingToScore[ score.rating ] * score.weight;
        totalWeight += score.weight;
      }
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Determine overall rating from score
   */
  private determineOverallRating(score: number): QualityEvaluationResult[ "overall" ] {
    if (score >= this.qualityConfig.acceptThreshold) return "ACCEPT";
    if (score >= this.qualityConfig.minorIssueThreshold) return "ACCEPT_WITH_NOTES";
    if (score >= this.qualityConfig.majorIssueThreshold) return "REGENERATE_MINOR";
    return "FAIL";
  }

  /**
   * Internal: Log attempt result concisely.
   */
  private logAttemptResult(attempt: number, score: number, rating: string): void {
    const scorePercent = (score * 100).toFixed(1);
    const icon = score >= this.qualityConfig.acceptThreshold ? '✓' : '⚠';
    console.log(`   ${icon} Attempt ${attempt}: ${scorePercent}% (${rating})`);
  }

  /**
   * Log evaluation results
   */
  private logEvaluationResults(
    id: number,
    evaluation: QualityEvaluationResult,
    overallScore: number
  ): void {
    const scorePercentage = (overallScore * 100).toFixed(1);

    console.log(`   Overall Rating ${id}: ${evaluation.overall} (${scorePercentage}%)`);

    Object.entries(evaluation.scores).forEach(([ category, score ]) => {
      const icon = score.rating === "PASS" ? "✓" :
        score.rating === "MINOR_ISSUES" ? "⚠" : "✗";
      console.log(`     ${icon} ${category}: ${score.rating}`);
    });

    if (evaluation.issues.length > 0) {
      console.log(`   Issues found: ${evaluation.issues.length}`);
      evaluation.issues.forEach((issue, i) => {
        console.log(`     ${i + 1}. [${issue.severity}] ${issue.description}`);
      });
    }
  }

  /**
   * Save evaluation to storage for audit trail
   */
  private async saveEvaluation(
    pathParams: GcsObjectPathParams,
    evaluation: QualityEvaluationResult
  ): Promise<void> {
    const evaluationPath = await this.storageManager.getGcsObjectPath(pathParams);

    await this.storageManager.uploadJSON(evaluation, evaluationPath);
  }

  /**
   * Get default passing scores (fallback)
   */
  private getDefaultScores(): QualityEvaluationResult[ "scores" ] {
    return {
      narrativeFidelity: { rating: "PASS", weight: 0.30, details: "Not evaluated" },
      characterConsistency: { rating: "PASS", weight: 0.25, details: "Not evaluated" },
      technicalQuality: { rating: "PASS", weight: 0.20, details: "Not evaluated" },
      emotionalAuthenticity: { rating: "PASS", weight: 0.15, details: "Not evaluated" },
      continuity: { rating: "PASS", weight: 0.10, details: "Not evaluated" }
    };
  }
}
