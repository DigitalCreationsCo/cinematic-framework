import { Character, Location, WorkflowMetrics, AttemptMetric, Trend, RegressionState, ValidDuration, VALID_DURATIONS, Storyboard, Project, WorkflowState, AssetRegistry, AssetKey, AssetType, AssetHistory, AssetVersion } from "../types/pipeline.types";

/**
 * Sanitizes the storyboard by removing any potentially hallucinated asset URLs.
 * This ensures that planning nodes do not accidentally introduce fake assets.
 *
 * @param storyboard - The storyboard to sanitize.
 * @returns A deep copy of the storyboard with asset fields removed.
 */
export function deleteBogusUrlsStoryboard(storyboard: Pick<Project, "metadata" | "characters" | "locations" | "scenes">): Storyboard {
  const clean: Project = JSON.parse(JSON.stringify(storyboard));

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
 */
export function formatCharacterSpecs(characters: Character[]): string {
  return characters
    .map(char => {
      return `Name:${char.name} ID:${char.id}:
  - Hair: ${char.physicalTraits.hair}
  - Clothing: ${char.physicalTraits.clothing}
  - Accessories: ${char.physicalTraits.accessories.join(", ")}
  - Reference: ${char.assets[ 'character_image' ]?.versions[ char.assets[ 'character_image' ]?.best ].data || "None"}`;
    })
    .join("\n\n");
}

/**
 * Format location specifications for prompt
 */
export function formatLocationSpecs(locations: Location[]): string {
  return locations
    .map(location => {
      return `Name:${location.name} ID:${location.id}:
  - Description: ${location.assets[ 'location_image' ]?.versions[ location.assets[ 'location_image' ]?.best ].data || "None"}
  - Lighting: ${JSON.stringify(location.lightingConditions)}
  - Time of Day: ${location.timeOfDay}
  - Reference: ${location.assets[ 'location_image' ]?.versions[ location.assets[ 'location_image' ]?.best ].data || "None"}`;
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
  newAttempt: AttemptMetric
): WorkflowMetrics {
  // Clone to avoid mutation of the input if it's from state
  const metrics = { ...currentMetrics };

  // Initialize defaults if missing (though types say they should be there)
  const regression = metrics.regression || { count: 0, sumX: 0, sumY_a: 0, sumY_q: 0, sumXY_a: 0, sumXY_q: 0, sumX2: 0 };
  const trendHistory = metrics.trendHistory ? [ ...metrics.trendHistory ] : [];
  const attemptMetrics = metrics.attemptMetrics ? [ ...metrics.attemptMetrics ] : [];

  // Add new attempt
  attemptMetrics.push(newAttempt);

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
    attemptMetrics,
    trendHistory,
    regression: newRegression,
    globalTrend: newTrend,
  };
}

export function mergeParamsIntoState(
  currentState: WorkflowState,
  params: Partial<WorkflowState>
): Partial<Project> {
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