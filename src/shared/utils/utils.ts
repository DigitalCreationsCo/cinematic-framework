import { Character, Location, WorkflowMetrics, Trend, RegressionState, ValidDuration, VALID_DURATIONS, Storyboard, Project, WorkflowState, AssetRegistry, AssetKey, AssetType, AssetHistory, AssetVersion, VersionMetric, StoryboardAttributes, CharacterAttributes, LocationAttributes } from "../types/workflow.types";
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

export function roundToValidDuration(duration: number): ValidDuration {
  const validDurations = VALID_DURATIONS;
  let closest: ValidDuration = validDurations[ 0 ];
  let minDiff = Math.abs(duration - validDurations[ 0 ]);

  for (let i = 1; i < validDurations.length; i++) {
    const diff = Math.abs(duration - validDurations[ i ]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = validDurations[ i ];
    }
  }
  return closest;
}

/**
 * Format character specifications for prompt
 * TODO MAKE MORE DESCRIPTIVE
 */
export function formatCharacterSpecs<C extends Character | CharacterAttributes>(characters: C[]): string {
  return characters
    .map(char => {
      const assets = ('assets' in char) && char.assets;
      const reference = assets
        ? char.assets[ 'character_image' ]?.versions[ char.assets[ 'character_image' ]?.best ].data
        : "None";
      return `Name:${char.name} Reference ID:${char.referenceId}:
  - Hair: ${char.physicalTraits.hair}
  - Clothing: ${char.physicalTraits.clothing}
  - Accessories: ${char.physicalTraits.accessories.join(", ")}
  - Reference: ${reference}`;
    })
    .join("\n\n");
}

/**
 * Format location specifications for prompt
 * TODO MAKE MORE DESCRIPTIVE
 */
export function formatLocationSpecs<L extends Location | LocationAttributes>(locations: L[]): string {
  return locations
    .map(location => {
      const assets = ('assets' in location) && location.assets;
      const description = assets ? assets[ 'location_description' ]?.versions[ assets[ 'location_description' ]?.best ].data : location.type;
      const reference = assets ? assets[ 'location_image' ]?.versions[ assets[ 'location_image' ]?.best ].data : "None";
      return `Name:${location.name} Reference ID:${location.referenceId}:
  - Description: ${description}
  - Lighting: ${JSON.stringify(location.lightingConditions)}
  - Time of Day: ${location.timeOfDay}
  - Reference: ${reference}`;
    })
    .join("\n\n");
}

/**
 * Calculates learning trends using incremental linear regression.
 * Updates the metrics state with the new attempt data.
 * 
 * @param currentMetrics - The current state of workflow metrics.
 * @param newAttempt - The new attempt metric to add.
 * @returns The updated workflow metrics with new regression state and trends.
 */
export function calculateLearningTrends(
  currentMetrics: WorkflowMetrics,
  assetKey: AssetKey,
  newAttempt: VersionMetric
): WorkflowMetrics {
  // Clone to avoid mutation of the input if it's from state
  const metrics = { ...currentMetrics };

  // Initialize defaults if missing (though types say they should be there)
  const regression = metrics.regression || { count: 0, sumX: 0, sumY_a: 0, sumY_q: 0, sumXY_a: 0, sumXY_q: 0, sumX2: 0 };
  const trendHistory = metrics.trendHistory ? [ ...metrics.trendHistory ] : [];
  const versionMetrics = metrics.versionMetrics || {};

  versionMetrics[ assetKey ] = versionMetrics[ assetKey ] || [];
  versionMetrics[ assetKey ].push(newAttempt);

  // Update regression stats
  const n = regression.count + 1;
  const x = n; // Time step is just the index 1..N
  const y_q = newAttempt.finalScore;

  const newRegression: RegressionState = {
    count: n,
    sumX: regression.sumX + x,
    sumY_a: 0, // We are not tracking attempts vs attempts anymore, but quality over time
    sumY_q: regression.sumY_q + y_q,
    sumXY_a: 0,
    sumXY_q: regression.sumXY_q + x * y_q,
    sumX2: regression.sumX2 + x * x,
  };

  let qualityTrendSlope = 0;

  if (n >= 2) {
    const slope_q = (n * newRegression.sumXY_q - newRegression.sumX * newRegression.sumY_q) / (n * newRegression.sumX2 - newRegression.sumX * newRegression.sumX);
    qualityTrendSlope = isNaN(slope_q) ? 0 : slope_q;
  }

  const newTrend: Trend = {
    averageAttempts: 0, // Not relevant for single attempt stream
    attemptTrendSlope: 0,
    qualityTrendSlope,
  };

  trendHistory.push(newTrend);

  return {
    ...metrics,
    versionMetrics,
    trendHistory,
    regression: newRegression,
    globalTrend: newTrend,
  };
}


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

/**
 * Returns the best version from local assets.
 * Does not modify the DB.
 */
const bestAssetsCache = new WeakMap();

export function getAllBestFromAssets(assets: AssetRegistry | undefined | null, assetKey?: AssetKey): Partial<Record<AssetKey, AssetVersion>> {
  if (!assets) return {} as Partial<Record<AssetKey, AssetVersion>>;

  if (bestAssetsCache.has(assets)) {
    return bestAssetsCache.get(assets)!;
  }

  const allAssetsBest: any = {};
  Object.entries(assets).forEach(([ k, h ]) => {
    if (h && h.versions && h.versions[ h.best ]) {
      allAssetsBest[ k ] = h.versions[ h.best ];
    }
  });

  const result = allAssetsBest as Partial<Record<AssetKey, AssetVersion>>;
  bestAssetsCache.set(assets, result);
  return result;
};

