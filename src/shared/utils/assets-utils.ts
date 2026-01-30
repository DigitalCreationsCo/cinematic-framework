// shared/utils/asset-utils.ts
import { AssetKey, AssetRegistry, AssetVersion, AssetHistory } from "../types/assets.types.js";

/**
 * High-performance asset utility functions with proper caching and memoization.
 * Follows Google's performance best practices for client-side data access.
 */

// ============================================================================
// CACHE INFRASTRUCTURE
// ============================================================================

/**
 * Immutable cache using WeakMap for automatic garbage collection.
 * Cache is invalidated when the registry object changes.
 */
class AssetCache {
  private bestCache = new WeakMap<AssetRegistry, Partial<Record<AssetKey, AssetVersion>>>();
  private latestCache = new WeakMap<AssetRegistry, Partial<Record<AssetKey, AssetVersion>>>();
  private historyCache = new WeakMap<AssetRegistry, Map<AssetKey, AssetHistory>>();

  getBest(assets: AssetRegistry): Partial<Record<AssetKey, AssetVersion>> {
    if (!this.bestCache.has(assets)) {
      this.bestCache.set(assets, this.computeBest(assets));
    }
    return this.bestCache.get(assets)!;
  }

  getLatest(assets: AssetRegistry): Partial<Record<AssetKey, AssetVersion>> {
    if (!this.latestCache.has(assets)) {
      this.latestCache.set(assets, this.computeLatest(assets));
    }
    return this.latestCache.get(assets)!;
  }

  getHistory(assets: AssetRegistry, key: AssetKey): AssetHistory | undefined {
    if (!this.historyCache.has(assets)) {
      this.historyCache.set(assets, new Map());
    }
    
    const cache = this.historyCache.get(assets)!;
    if (!cache.has(key)) {
      const history = assets[key];
      if (history) {
        cache.set(key, history);
      }
    }
    return cache.get(key);
  }

  private computeBest(assets: AssetRegistry): Partial<Record<AssetKey, AssetVersion>> {
    const result: Partial<Record<AssetKey, AssetVersion>> = {};
    
    for (const [key, history] of Object.entries(assets) as [AssetKey, AssetHistory][]) {
      if (!history?.versions?.length || history.best === 0) continue;
      
      // Direct array access is faster than find()
      const bestVersion = history.versions.find(v => v.version === history.best);
      if (bestVersion) {
        result[key] = bestVersion;
      }
    }
    
    return result;
  }

  private computeLatest(assets: AssetRegistry): Partial<Record<AssetKey, AssetVersion>> {
    const result: Partial<Record<AssetKey, AssetVersion>> = {};
    
    for (const [key, history] of Object.entries(assets) as [AssetKey, AssetHistory][]) {
      if (!history?.versions?.length) continue;
      
      // Latest is always at the end of the array (head)
      const latestVersion = history.versions.find(v => v.version === history.head);
      if (latestVersion) {
        result[key] = latestVersion;
      }
    }
    
    return result;
  }

  clear() {
    // WeakMaps don't have a clear method, but they auto-GC
    // This is here for API completeness
  }
}

const cache = new AssetCache();

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get all best versions from an asset registry.
 * Results are cached and automatically invalidated when registry changes.
 * 
 * Time Complexity: O(1) cached, O(n) uncached where n = number of asset keys
 * 
 * @param assets - Asset registry from project/scene/character/location
 * @returns Map of asset keys to their best versions
 */
export function getAllBestFromAssets(
  assets: AssetRegistry | undefined | null
): Partial<Record<AssetKey, AssetVersion>> {
  if (!assets) return {};
  return cache.getBest(assets);
}

/**
 * Get all latest (head) versions from an asset registry.
 * 
 * @param assets - Asset registry
 * @returns Map of asset keys to their latest versions
 */
export function getAllLatestFromAssets(
  assets: AssetRegistry | undefined | null
): Partial<Record<AssetKey, AssetVersion>> {
  if (!assets) return {};
  return cache.getLatest(assets);
}

/**
 * Get the best version for a specific asset key.
 * 
 * Time Complexity: O(1) cached, O(n) uncached for first access
 * 
 * @param assets - Asset registry
 * @param assetKey - Specific asset to retrieve
 * @returns Best version or undefined
 */
export function getBestAsset(
  assets: AssetRegistry | undefined | null,
  assetKey: AssetKey
): AssetVersion | undefined {
  if (!assets) return undefined;
  return cache.getBest(assets)[assetKey];
}

/**
 * Get the latest version for a specific asset key.
 * 
 * @param assets - Asset registry
 * @param assetKey - Specific asset to retrieve
 * @returns Latest version or undefined
 */
export function getLatestAsset(
  assets: AssetRegistry | undefined | null,
  assetKey: AssetKey
): AssetVersion | undefined {
  if (!assets) return undefined;
  return cache.getLatest(assets)[assetKey];
}

/**
 * Get a specific version by number.
 * 
 * Time Complexity: O(n) where n = number of versions for this key
 * 
 * @param assets - Asset registry
 * @param assetKey - Asset key
 * @param version - Version number to retrieve
 * @returns Specific version or undefined
 */
export function getAssetVersion(
  assets: AssetRegistry | undefined | null,
  assetKey: AssetKey,
  version: number
): AssetVersion | undefined {
  if (!assets) return undefined;
  
  const history = cache.getHistory(assets, assetKey);
  if (!history) return undefined;
  
  return history.versions.find(v => v.version === version);
}

/**
 * Get all versions for a specific asset key, sorted by version number.
 * 
 * @param assets - Asset registry
 * @param assetKey - Asset key
 * @returns Array of all versions, newest first
 */
export function getAllAssetVersions(
  assets: AssetRegistry | undefined | null,
  assetKey: AssetKey
): AssetVersion[] {
  if (!assets) return [];
  
  const history = cache.getHistory(assets, assetKey);
  if (!history) return [];
  
  // Return a copy to prevent mutation, sorted descending
  return [...history.versions].sort((a, b) => b.version - a.version);
}

/**
 * Get asset history metadata (head, best pointers).
 * 
 * @param assets - Asset registry
 * @param assetKey - Asset key
 * @returns History metadata or undefined
 */
export function getAssetHistoryMetadata(
  assets: AssetRegistry | undefined | null,
  assetKey: AssetKey
): { head: number; best: number; count: number } | undefined {
  if (!assets) return undefined;
  
  const history = cache.getHistory(assets, assetKey);
  if (!history) return undefined;
  
  return {
    head: history.head,
    best: history.best,
    count: history.versions.length,
  };
}

/**
 * Check if an asset exists and has at least one version.
 * 
 * @param assets - Asset registry
 * @param assetKey - Asset key to check
 * @returns true if asset exists with versions
 */
export function hasAsset(
  assets: AssetRegistry | undefined | null,
  assetKey: AssetKey
): boolean {
  if (!assets) return false;
  const history = assets[assetKey];
  return !!(history && history.versions.length > 0);
}

/**
 * Check if a specific version exists.
 * 
 * @param assets - Asset registry
 * @param assetKey - Asset key
 * @param version - Version number to check
 * @returns true if version exists
 */
export function hasAssetVersion(
  assets: AssetRegistry | undefined | null,
  assetKey: AssetKey,
  version: number
): boolean {
  if (!assets) return false;
  const history = assets[assetKey];
  return !!(history && history.versions.some(v => v.version === version));
}

/**
 * Get asset data URL (best version by default).
 * Convenience helper for UI components.
 * 
 * @param assets - Asset registry
 * @param assetKey - Asset key
 * @param version - Optional specific version, defaults to best
 * @returns Data URL string or undefined
 */
export function getAssetUrl(
  assets: AssetRegistry | undefined | null,
  assetKey: AssetKey,
  version?: number
): string | undefined {
  if (!assets) return undefined;
  
  if (version !== undefined) {
    return getAssetVersion(assets, assetKey, version)?.data;
  }
  
  return getBestAsset(assets, assetKey)?.data;
}

/**
 * Batch get multiple asset URLs.
 * More efficient than calling getAssetUrl multiple times.
 * 
 * @param assets - Asset registry
 * @param assetKeys - Array of asset keys to retrieve
 * @returns Map of asset keys to URLs
 */
export function getAssetUrls(
  assets: AssetRegistry | undefined | null,
  assetKeys: AssetKey[]
): Partial<Record<AssetKey, string>> {
  if (!assets) return {};
  
  const bestAssets = cache.getBest(assets);
  const result: Partial<Record<AssetKey, string>> = {};
  
  for (const key of assetKeys) {
    const asset = bestAssets[key];
    if (asset) {
      result[key] = asset.data;
    }
  }
  
  return result;
}

// ============================================================================
// FILTERING & QUERYING
// ============================================================================

/**
 * Get all assets of a specific type.
 * 
 * @param assets - Asset registry
 * @param assetType - Type to filter by (video, image, text, etc.)
 * @param useBest - If true, returns best versions, otherwise latest
 * @returns Filtered asset map
 */
export function getAssetsByType(
  assets: AssetRegistry | undefined | null,
  assetType: AssetVersion['type'],
  useBest = true
): Partial<Record<AssetKey, AssetVersion>> {
  if (!assets) return {};
  
  const sourceAssets = useBest ? cache.getBest(assets) : cache.getLatest(assets);
  const result: Partial<Record<AssetKey, AssetVersion>> = {};
  
  for (const [key, version] of Object.entries(sourceAssets) as [AssetKey, AssetVersion][]) {
    if (version.type === assetType) {
      result[key] = version;
    }
  }
  
  return result;
}

/**
 * Get all assets created after a specific date.
 * 
 * @param assets - Asset registry
 * @param since - Date threshold
 * @param useBest - If true, filters best versions, otherwise latest
 * @returns Filtered asset map
 */
export function getAssetsSince(
  assets: AssetRegistry | undefined | null,
  since: Date,
  useBest = true
): Partial<Record<AssetKey, AssetVersion>> {
  if (!assets) return {};
  
  const sourceAssets = useBest ? cache.getBest(assets) : cache.getLatest(assets);
  const result: Partial<Record<AssetKey, AssetVersion>> = {};
  const sinceTime = since.getTime();
  
  for (const [key, version] of Object.entries(sourceAssets) as [AssetKey, AssetVersion][]) {
    if (version.createdAt.getTime() > sinceTime) {
      result[key] = version;
    }
  }
  
  return result;
}

// ============================================================================
// VALIDATION & QUALITY
// ============================================================================

/**
 * Check if asset has quality evaluation.
 * 
 * @param version - Asset version to check
 * @returns true if evaluated
 */
export function isAssetEvaluated(version: AssetVersion | undefined): boolean {
  return !!(version?.metadata?.evaluation);
}

/**
 * Get quality score from asset.
 * 
 * @param version - Asset version
 * @returns Quality score or undefined
 */
export function getAssetQualityScore(version: AssetVersion | undefined): number | undefined {
  return version?.metadata?.evaluation?.score;
}

/**
 * Check if asset passes quality threshold.
 * 
 * @param version - Asset version
 * @param threshold - Minimum quality score (0-1)
 * @returns true if passes threshold
 */
export function assetPassesQuality(
  version: AssetVersion | undefined,
  threshold: number
): boolean {
  const score = getAssetQualityScore(version);
  return score !== undefined && score >= threshold;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if asset is a video.
 */
export function isVideoAsset(version: AssetVersion | undefined): version is AssetVersion & { type: 'video' } {
  return version?.type === 'video';
}

/**
 * Type guard to check if asset is an image.
 */
export function isImageAsset(version: AssetVersion | undefined): version is AssetVersion & { type: 'image' } {
  return version?.type === 'image';
}

/**
 * Type guard to check if asset is text.
 */
export function isTextAsset(version: AssetVersion | undefined): version is AssetVersion & { type: 'text' } {
  return version?.type === 'text';
}

/**
 * Type guard to check if asset is JSON.
 */
export function isJsonAsset(version: AssetVersion | undefined): version is AssetVersion & { type: 'json' } {
  return version?.type === 'json';
}