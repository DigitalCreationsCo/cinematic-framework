export const promptVersion = "3.0.0-costume-makeup";

import { Character } from "../../shared/pipeline-types";
import { buildSafetyGuidelinesPrompt } from "./safety-instructions";

/**
 * COSTUME & MAKEUP DEPT - Character Appearance Specification
 * Generates reference images and specifies exact character appearance for continuity
 */

export const buildCostumeAndMakeupPrompt = (character: Character): string => {
  const aliases =
    character.aliases && character.aliases.length > 0
      ? ` (also known as: ${character.aliases.join(", ")})`
      : "";

  return `COSTUME & MAKEUP SPECIFICATION: ${character.name}${aliases}

Generate photorealistic reference image with EXACT specifications below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHYSICAL DESCRIPTION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${character.description}

AGE: ${character.age || "Adult 25-35 (default if not specified)"}
BUILD: ${character.physicalTraits?.build || "Average height and build"}
ETHNICITY: Generic, non-specific (avoid celebrity likeness)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXACT TRAITS (reference anchor points):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HAIR:
- Style: ${character.physicalTraits.hair}
- Color: [Specific shade required]
- Length: [Specific length required]
- Texture: [Straight/wavy/curly/coily]

CLOTHING:
${typeof character.physicalTraits.clothing === "string"
      ? `- ${character.physicalTraits.clothing}`
      : Array.isArray(character.physicalTraits.clothing)
        ? character.physicalTraits.clothing.map((item) => `- ${item}`).join("\n")
        : "- Clothing description required"
    }

ACCESSORIES:
${character.physicalTraits.accessories && character.physicalTraits.accessories.length > 0
      ? character.physicalTraits.accessories.map((item) => `- ${item}`).join("\n")
      : "- None"
    }

DISTINCTIVE FEATURES:
${character.physicalTraits.distinctiveFeatures &&
      character.physicalTraits.distinctiveFeatures.length > 0
      ? character.physicalTraits.distinctiveFeatures.map((feature) => `- ${feature}`).join("\n")
      : "- None specified"
    }

${character.appearanceNotes && character.appearanceNotes.length > 0
      ? `
ADDITIONAL NOTES:
${character.appearanceNotes.map((note) => `- ${note}`).join("\n")}
`
      : ""
    }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE OUTPUT SPECIFICATIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Framing: Full-body portrait, head to toe visible
Background: Neutral gray, no distractions
Lighting: Soft, even illumination from front, minimal shadows
Pose: Standing neutral, facing camera directly, arms at sides naturally
Expression: Neutral but engaged (eyes open, natural resting face)
Focus: Entire figure sharp and clear
Camera: Straight-on eye-level angle, no dramatic angles

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PURPOSE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This image is the CONTINUITY REFERENCE. Every scene featuring this character must match this appearance EXACTLY.
- Hair color, style, length MUST NOT change
- Clothing MUST be identical (same garments, colors, condition)
- Accessories MUST appear in same positions
- Body type and facial features MUST remain consistent

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAFETY CONSTRAINTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${buildSafetyGuidelinesPrompt()}

- NO celebrity names or likeness
- NO specific real people
- Describe as "a person with [generic attributes]"
- If age < 18 provided, output as "young adult, 18-20 years old"

OUTPUT: Generate photorealistic reference image per specifications. No text in image.
`;
};

export const buildCostumeAndMakeupSpec = (character: Character): string => {
  return `
CHARACTER APPEARANCE SPEC: ${character.name}

Hair: ${character.physicalTraits.hair}
Clothing: ${typeof character.physicalTraits.clothing === "string"
      ? character.physicalTraits.clothing
      : character.physicalTraits.clothing?.join(", ")
    }
Accessories: ${character.physicalTraits.accessories?.join(", ") || "None"}
Distinctive Features: ${character.physicalTraits.distinctiveFeatures?.join(", ") || "None"}

REFERENCE IMAGE: ${character.referenceImages?.[ 0 ] || "Not yet generated"}

CONSTRAINT: Appearance MUST match reference image EXACTLY in all scenes.
`;
};

export const buildCostumeAndMakeupNarrative = (character: Character): string => {
  const clothing = typeof character.physicalTraits.clothing === "string"
    ? character.physicalTraits.clothing
    : character.physicalTraits.clothing?.join(", ");

  const accessories = character.physicalTraits.accessories && character.physicalTraits.accessories.length > 0
    ? ` They are accessorized with ${character.physicalTraits.accessories.join(", ")}.`
    : "";

  const features = character.physicalTraits.distinctiveFeatures && character.physicalTraits.distinctiveFeatures.length > 0
    ? ` Distinctive features include ${character.physicalTraits.distinctiveFeatures.join(", ")}.`
    : "";

  return `${character.name} is ${character.description}. They have ${character.physicalTraits.hair} hair and are wearing ${clothing}.${accessories}${features}`;
};
