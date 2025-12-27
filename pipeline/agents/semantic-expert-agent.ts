import { LlmController } from "../llm/controller";
import { Storyboard, zodToJSONSchema } from "../../shared/pipeline-types";
import { buildSemanticRulesPrompt } from "../prompts/semantic-rules-instruction";
import { buildllmParams } from "../llm/google/llm-params";
import { z } from "zod";

const SemanticRuleSchema = z.object({
    category: z.string(),
    rule: z.string()
});

const SemanticRulesResponseSchema = z.object({
    rules: z.array(SemanticRuleSchema)
});

export class SemanticExpertAgent {
    private llm: LlmController;

    constructor(llm: LlmController) {
        this.llm = llm;
    }

    async generateRules(storyboard: Storyboard): Promise<string[]> {
        console.log("   🧠 SEMANTIC EXPERT: Analyzing storyboard for constraints...");

        // Format context from storyboard
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
                contents: [ { role: "user", parts: [ { text: prompt } ] } ],
                config: {
                    responseJsonSchema: zodToJSONSchema(SemanticRulesResponseSchema),
                    temperature: 0.4
                }
            }));

            if (!response.text) {
                console.warn("   ⚠️ Semantic Expert returned no text.");
                return [];
            }

            const data = JSON.parse(response.text);
            const parsed = SemanticRulesResponseSchema.parse(data);

            console.log(`   ✓ Generated ${parsed.rules.length} semantic constraints.`);

            // Return just the rule strings
            return parsed.rules.map(r => r.rule);

        } catch (error) {
            console.error("   ✗ Failed to generate semantic rules:", error);
            return []; // Fail gracefully (empty array means no *extra* rules)
        }
    }
}
