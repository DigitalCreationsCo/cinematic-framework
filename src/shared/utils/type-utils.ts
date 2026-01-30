import { AssetKey } from "../types/assets.types.js";
import { VALID_DURATIONS, ValidDurations } from "../types/base.types.js";
import { RegressionState, Trend, VersionMetric, WorkflowMetrics } from "../types/metrics.types.js";
import { Character, CharacterAttributes, Location, LocationAttributes } from "../types/index.js";

/**
 * Format character specifications for prompt
 * TODO MAKE MORE DESCRIPTIVE
 */
export function formatCharacterSpecs<C extends Character | CharacterAttributes>(characters: C[]): string {
    return characters
        .map(char => {
            const assets = ('assets' in char) && char.assets;
            const image = assets
                ? char.assets[ 'character_image' ]?.versions[ char.assets[ 'character_image' ]?.best ].data
                : "None";
            return `Name:${char.name}
- Reference ID:${char.referenceId}
- Hair: ${char.physicalTraits.hair}
- Clothing: ${char.physicalTraits.clothing}
- Accessories: ${char.physicalTraits.accessories.join(", ")}
- Image: ${image}`;
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
            const image = assets ? assets[ 'location_image' ]?.versions[ assets[ 'location_image' ]?.best ].data : "None";
            
            return `Name:${location.name} 
- Reference ID:${location.referenceId}
- Description: ${description}
- Time of Day: ${location.timeOfDay}
- Lighting: ${JSON.stringify(location.lightingConditions)}
- Image: ${image}`;
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