import { z } from "zod";

// ============================================================================
// QUALITY EVALUATION SCHEMAS (Quality Control Supervisor)
// ============================================================================


export const DepartmentEnum = z.enum([
    "director",
    "cinematographer",
    "gaffer",
    "script_supervisor",
    "costume",
    "production_design"
]);
export type Department = z.infer<typeof DepartmentEnum>;


// Shared severity enum
export const SeverityEnum = z.enum([ "critical", "major", "minor" ]);
export type Severity = z.infer<typeof SeverityEnum>;


// Shared rating enum
export const RatingEnum = z.enum([ "PASS", "MINOR_ISSUES", "MAJOR_ISSUES", "FAIL" ]);
export type Rating = z.infer<typeof RatingEnum>;


export const QualityScore = z.object({
    rating: RatingEnum,
    weight: z.number().min(0).max(1),
    details: z.string().describe("Detailed explanation"),
});
export type QualityScore = z.infer<typeof QualityScore>;


export const QualityIssue = z.object({
    department: DepartmentEnum.describe("Which department's specs were not met"),
    category: z.string().describe("Issue category (narrative, composition, lighting, continuity, appearance)"),
    severity: SeverityEnum,
    description: z.string().describe("Specific problem observed"),
    videoTimestamp: z.string().optional().describe("Timestamp in video (e.g., 0:02-0:04)"),
    locationInFrame: z.string().optional().describe("Location in frame for image issues"),
    suggestedFix: z.string().describe("How the department should revise specs"),
});
export type QualityIssue = z.infer<typeof QualityIssue>;


export const PromptCorrection = z.object({
    department: DepartmentEnum,
    issueType: z.string(),
    originalPromptSection: z.string(),
    correctedPromptSection: z.string(),
    reasoning: z.string(),
});
export type PromptCorrection = z.infer<typeof PromptCorrection>;


export const QualityEvaluation = z.object({
    scores: z.object({
        narrativeFidelity: QualityScore,
        characterConsistency: QualityScore,
        technicalQuality: QualityScore,
        emotionalAuthenticity: QualityScore,
        continuity: QualityScore,
    }),
    issues: z.array(QualityIssue),
    feedback: z.string().describe("Overall summary of quality assessment"),
    promptCorrections: z.array(PromptCorrection).optional(),
    ruleSuggestion: z.string().optional().describe("A new global rule to prevent future systemic issues"),
});


export const QualityEvaluationResult = QualityEvaluation.extend({
    grade: z.enum([ "ACCEPT", "ACCEPT_WITH_NOTES", "REGENERATE_MINOR", "REGENERATE_MAJOR", "FAIL" ]),
    score: z.number().describe("Final quality score"),
});
export type QualityEvaluationResult = z.infer<typeof QualityEvaluationResult>;


export interface QualityConfig {
    enabled: boolean;
    acceptThreshold: number;
    minorIssueThreshold: number;
    majorIssueThreshold: number;
    failThreshold: number;
    maxRetries: number;
    safetyRetries: number;
}
