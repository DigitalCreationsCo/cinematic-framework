import { TextModelController } from "../llm/text-model-controller.js";
import { Storyboard } from "../types/index.js";
import { getJSONSchema } from '../utils/utils.js';
import { buildSemanticRulesPrompt } from "../prompts/semantic-rules-instruction.js";
import { buildllmParams } from "../llm/google/google-llm-params.js";
import { z } from "zod";
import { qualityCheckModelName } from "../llm/google/models.js";
import { GenerativeResultEnvelope, GenerativeResultSemanticAnalysis, JobRecordSemanticAnalysis } from "../types/job.types.js";

const SemanticRuleSchema = z.object({
    category: z.string(),
    rule: z.string()
});

const SemanticRulesResponseSchema = z.object({
    rules: z.array(SemanticRuleSchema)
});

export class SemanticExpertAgent {
    private llm: TextModelController;

    constructor(llm: TextModelController) {
        this.llm = llm;
    }

    async generateRules(storyboard: Storyboard): Promise<GenerativeResultSemanticAnalysis> {
        console.log("   🧠 SEMANTIC EXPERT: Analyzing storyboard for constraints...");
        const context = `
      Title: ${storyboard.metadata.title}
      Style: ${storyboard.metadata.style || 'Cinematic'}
      Mood: ${storyboard.metadata.mood || 'Neutral'}
      
      SCENES SUMMARY:
      ${storyboard.scenes.map(s => `- Scene ${s.id}: ${s.description}`).join('\n')}
    `;

        const prompt = buildSemanticRulesPrompt(context);

        try {
            const response = await this.llm.generateContent(buildllmParams({
                model: qualityCheckModelName,
                contents: [ { role: "user", parts: [ { text: prompt } ] } ],
                config: {
                    responseJsonSchema: getJSONSchema(SemanticRulesResponseSchema),
                    temperature: 0.4
                }
            }));

            if (!response.text) {
                console.warn("   ⚠️ Semantic Expert returned no text.");
                return { data: { dynamicRules: [] }, metadata: { model: qualityCheckModelName, attempts: 1, acceptedAttempt: 1 } };
            }

            const data = JSON.parse(response.text);
            const parsed = SemanticRulesResponseSchema.parse(data);

            console.log(`   ✓ Generated ${parsed.rules.length} semantic constraints.`);

            const dynamicRules = parsed.rules.map(r => r.rule);
            return { data: { dynamicRules }, metadata: { model: qualityCheckModelName, attempts: 1, acceptedAttempt: 1 } };

        } catch (error) {
            console.error("   ✗ Failed to generate semantic rules:", error);
            return { data: { dynamicRules: [] }, metadata: { model: qualityCheckModelName, attempts: 1, acceptedAttempt: 1 } };
        }
    }
}
