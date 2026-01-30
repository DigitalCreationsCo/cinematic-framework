import { Character, Location, WorkflowMetrics, Trend, RegressionState, VALID_DURATIONS, WorkflowState, AssetRegistry, AssetKey, AssetType, AssetHistory, AssetVersion, VersionMetric, StoryboardAttributes, CharacterAttributes, LocationAttributes, ValidDurations } from "../types/index.js";
import { z } from "zod";

/**
 * Depracated - Sanitized the storyboard by removing any potentially hallucinated asset URLs.
 * This ensured that planning nodes do not accidentally introduce fake assets.
 * Currently returns the same object, as asset have been moved to dedicated `assets` object.
 *
 * @param storyboard - The storyboard to sanitize.
 * @returns A deep copy of the storyboard with asset fields removed.
 */
export function deleteBogusUrlsStoryboard(storyboard: StoryboardAttributes): StoryboardAttributes {
  const clean: StoryboardAttributes = JSON.parse(JSON.stringify(storyboard));

  if (clean.scenes) {
    clean.scenes = clean.scenes.map((s) => {
      // s.generatedVideo = "";
      // s.startFrame = "";
      // s.endFrame = "";
      return s;
    });
  }

  if (clean.characters) {
    clean.characters = clean.characters.map((c) => {
      // c.referenceImages = [];
      return c;
    });
  }

  if (clean.locations) {
    clean.locations = clean.locations.map((l) => {
      // l.referenceImages = [];
      return l;
    });
  }

  return clean;
}

/**
 * Cleans the LLM output to extract the JSON string.
 * It removes markdown code blocks and extracts the JSON object.
 * 
 * @param output - The raw string output from the LLM.
 * @returns The cleaned JSON string.
 */
export function cleanJsonOutput(output: string): string {
  // Remove markdown code blocks
  let clean = output.replace(/```json\n?|```/g, "");

  // Find the first '{' and the last '}' to extract the JSON object
  const firstOpen = clean.indexOf("{");
  const lastClose = clean.lastIndexOf("}");

  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    clean = clean.substring(firstOpen, lastClose + 1);
  }

  return clean;
}

export const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};


/**
 * Converts a Zod schema to a Draft 2020-12 JSON Schema compatible with Vertex AI.
 * * @remarks
 * This function includes specific overrides to prevent the "Too many states for serving" 
 * error in Vertex AI by:
 * 1. Mapping `z.date()` to simple ISO-8601 strings.
 * 2. Stripping complex Regex patterns from UUIDs to simplify the Finite State Machine (FSM).
 * 3. Providing a hook to simplify or omit high-complexity objects like `assets` or `evaluation`.
 * * @param {z.ZodType} schema - The Zod schema to be converted.
 * @returns {Record<string, any>} An OpenAPI/Vertex AI compatible JSON Schema object.
 * * @example
 * ```typescript
 * const schema = z.object({ id: z.string().uuid() });
 * const jsonSchema = getJSONSchema(schema);
 * ```
 */
export const getJSONSchema = (schema: z.ZodType) => {
  return z.toJSONSchema(schema, {
    // Switching to openapi3 reduces meta-schema bloat
    target: "openapi3",
    unrepresentable: "any",
    override: (ctx) => {
      const zodSchema = ctx.zodSchema;

      // Force Dates to simple strings
      if (zodSchema instanceof z.ZodDate) {
        return { type: "string", description: "ISO 8601 date-time" };
      }

      // Force UUIDs to simple strings (Strips the complex Regex)
      if (zodSchema instanceof z.ZodUUID) {
        return { type: "string", description: "UUID format" };
      }

      return undefined;
    }
  });
};

export function mergeParamsIntoState(
  currentState: WorkflowState,
  params: Partial<WorkflowState>
): Partial<WorkflowState> {
  const updates: Partial<WorkflowState> = { ...currentState, ...params };

  // Merge scene prompt overrides
  // if (params..promptModification && params.sceneId !== undefined) {
  //   updates.scenePromptOverrides = {
  //     ...(currentState.scenePromptOverrides || {}),
  //     [ params.sceneId ]: params.promptModification
  //   };
  // }

  // // Merge creative prompt if provided
  // if (params.enhancedPrompt) {
  //   updates.enhancedPrompt = params.enhancedPrompt;
  // }

  // if (params.characters) {
  //   if (updates?.characters) {
  //     updates.characters = params.characters;
  //   }
  // }

  // if (params.sceneDescriptions && params.sceneDescriptions.length > 0) {
  //   if (updates?.scenes) {
  //     updates.scenes = updates.scenes.map((s, idx) => {
  //       return {
  //         ...s,
  //         description: params.sceneDescriptions![ idx ]
  //       };
  //     });
  //   }
  // }

  // Add other specific param mappings here as needed

  return updates;
}

export { roundToValidDuration } from "../types/base.types.js";
