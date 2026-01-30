// shared/types/character.types.ts
import { z } from "zod";

// ============================================================================
// PHYSICAL TRAITS
// ============================================================================

export const PhysicalTraits = z.object({
  hair: z.string().default("").describe("Specific hairstyle, color, length, texture"),
  clothing: z.array(z.string()).default([]).describe("Specific outfit description (string or array of garments)"),
  accessories: z.array(z.string()).default([]).describe("List of accessories"),
  distinctiveFeatures: z.array(z.string()).default([]).describe("List of distinctive features"),
  build: z.string().default("average").describe("Physical build description"),
  ethnicity: z.string().default("").describe("Ethnicity description (generic, non-specific)"),
}).describe("Costume & Makeup specifications");
export type PhysicalTraits = z.infer<typeof PhysicalTraits>;

// ============================================================================
// CHARACTER STATE
// ============================================================================

export const CharacterState = z.object({
  // Spatial continuity
  lastSeen: z.string().optional().describe("scene ID where character was last seen"),
  position: z.string().optional().describe("character's spatial position: left/center/right, foreground/background"),
  lastExitDirection: z.enum([ "left", "right", "up", "down", "none" ]).optional().describe("direction character exited frame in previous scene"),

  // Emotional progression
  emotionalState: z.string().optional().describe("character's current emotional state"),
  emotionalHistory: z.array(z.object({
    sceneId: z.string(),
    emotion: z.string(),
  })).optional().default([]).describe("emotional state timeline across scenes"),

  // Physical condition progression
  physicalCondition: z.string().optional().describe("accumulated damage, dirt, exhaustion"),
  injuries: z.array(z.object({
    type: z.string(),
    location: z.string(),
    severity: z.enum([ "minor", "moderate", "severe" ]),
    acquiredInScene: z.number(),
  })).optional().default([]).describe("injuries that persist across scenes"),

  // Appearance changes
  dirtLevel: z.enum([ "clean", "slightly_dirty", "dirty", "very_dirty", "covered" ]).optional().default("clean").describe("accumulation of dirt, mud, dust"),
  exhaustionLevel: z.enum([ "fresh", "slightly_tired", "tired", "exhausted", "collapsing" ]).optional().default("fresh").describe("progressive fatigue"),
  sweatLevel: z.enum([ "dry", "slight", "moderate", "heavy", "drenched" ]).optional().default("dry").describe("perspiration level"),

  // Costume state progression
  costumeCondition: z.object({
    tears: z.array(z.string()).optional().default([]).describe("torn areas (e.g., 'sleeve torn', 'pants ripped at knee')"),
    stains: z.array(z.string()).optional().default([]).describe("stains (e.g., 'blood on shirt', 'mud on pants')"),
    wetness: z.enum([ "dry", "damp", "wet", "soaked" ]).optional().default("dry").describe("moisture level of clothing"),
    damage: z.array(z.string()).optional().default([]).describe("other damage (e.g., 'burned collar', 'missing button')"),
  }).optional().describe("progressive costume degradation"),

  // Makeup/hair changes
  hairCondition: z.object({
    style: z.string().optional().describe("current style (should match baseline unless narrative justification)"),
    messiness: z.enum([ "pristine", "slightly_messy", "messy", "disheveled", "wild" ]).optional().default("pristine"),
    wetness: z.enum([ "dry", "damp", "wet", "soaked" ]).optional().default("dry"),
  }).optional().describe("progressive hair state changes"),
});
export type CharacterState = z.infer<typeof CharacterState>;

// ============================================================================
// CHARACTER ATTRIBUTES
// ============================================================================

export const CharacterAttributes = z.object({
  referenceId: z.string().describe("Narrative-scoped identifier for the character e.g. char_1"),
  name: z.string().describe("Character name"),
  aliases: z.array(z.string()).default([]).describe("Character aliases"),
  age: z.string().describe("Character age"),
  physicalTraits: PhysicalTraits,
  appearanceNotes: z.array(z.string()).default([]).describe("Additional appearance notes"),
  state: CharacterState.default(() => CharacterState.parse({})).describe("Character state"),
});
export type CharacterAttributes = z.infer<typeof CharacterAttributes>;
