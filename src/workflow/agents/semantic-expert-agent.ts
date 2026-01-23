import { TextModelController } from "../llm/text-model-controller";
import { Storyboard } from "../../shared/types/workflow.types";
import { getJSONSchema } from '../../shared/utils/utils';
import { buildSemanticRulesPrompt } from "../prompts/semantic-rules-instruction";
import { buildllmParams } from "../llm/google/google-llm-params";
import { z } from "zod";
import { qualityCheckModelName } from "../llm/google/models";
import { GenerativeResultEnvelope, JobRecordSemanticAnalysis } from "@shared/types/job.types";

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

    async generateRules(storyboard: Storyboard): Promise<GenerativeResultEnvelope<JobRecordSemanticAnalysis[ 'result' ]>> {
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
