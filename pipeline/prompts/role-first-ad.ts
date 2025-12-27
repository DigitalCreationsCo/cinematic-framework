export const promptVersion = "3.0.0-first-ad";

import { buildSafetyGuidelinesPrompt } from "./safety-instructions";

/**
 * FIRST ASSISTANT DIRECTOR - Technical Safety & Feasibility
 * Sanitizes prompts for safety compliance and validates technical feasibility
 */

export const buildFirstADPrompt = (allRoleOutputs: string, errorMessage?: string) => `
As the FIRST ASSISTANT DIRECTOR, ensure safety compliance and technical feasibility:

COMBINED SPECIFICATIONS FROM ALL DEPARTMENTS:
${allRoleOutputs}

${
  errorMessage
    ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAFETY FILTER ERROR DETECTED:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${errorMessage}

Your task: SANITIZE the specifications to prevent this error while preserving creative intent.
`
    : `
Your task: PROACTIVE SAFETY CHECK before generation.
`
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOP 3 SAFETY VIOLATIONS TO CHECK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. CELEBRITY LIKENESS (Codes: 29310472, 15236754)
   ❌ Find: "looks like [celebrity name]", "resembles [famous person]", "[actor] style"
   ✅ Replace: "a person with [generic physical traits]"

   Example:
   - Before: "looks like Tom Cruise with brown hair"
   - After: "a man, 30s, athletic build, short brown hair, confident demeanor"

2. CHILDREN (Codes: 58061214, 17301594)
   ❌ Find: Any age < 18, "child", "kid", "teenager"
   ✅ Replace: "young adult, 18-20 years old"

   Example:
   - Before: "a 12-year-old boy"
   - After: "a young adult, 18-20 years old, youthful appearance"

3. VIOLENCE/DANGEROUS CONTENT (Codes: 61493863, 56562880)
   ❌ Find: Graphic violence, weapons aimed at people, blood/gore
   ✅ Replace: Implication without graphic depiction, or remove

   Example:
   - Before: "character bleeding from wound, gun pointed at face"
   - After: "character in tense confrontation, defensive posture"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECONDARY CHECKS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☐ Sexual content (Codes: 90789179, 63429089, 43188360): Remove explicit descriptions
☐ Hate speech (Codes: 57734940, 22137204): Remove offensive language
☐ PII (Code: 92201652): Remove names, addresses, phone numbers of real people
☐ Prohibited content (Codes: 89371032, 49114662, 72817394): Remove illegal activities

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECHNICAL FEASIBILITY CHECK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☐ Duration valid: 4, 6, or 8 seconds only
☐ Complexity appropriate: Can this be generated in one video clip?
☐ Continuity achievable: Are reference images available?
☐ Specifications concrete: No vague terms like "powerful" or "impactful"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAFETY GUIDELINES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${buildSafetyGuidelinesPrompt()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return SANITIZED specifications with:
1. All safety violations corrected
2. Original creative intent preserved
3. Technical feasibility confirmed
4. Concrete, actionable language throughout

PRINCIPLE: Minimal changes. Only modify what violates policy or is technically infeasible.

OUTPUT FORMAT: Plain text (not JSON). Return the corrected prompt text only.
`;
