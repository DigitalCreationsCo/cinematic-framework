// client/src/components/AssetHistoryPicker.optimized.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.js";
import { ScrollArea } from "#/components/ui/scroll-area.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.js";
import { Badge } from "#/components/ui/badge.js";
import { Button } from "#/components/ui/button.js";
import { useEffect, useState, useMemo, useCallback, memo } from "react";
import { getSceneAssets } from "#/lib/api.js";
import { Skeleton } from "#/components/ui/skeleton.js";
import { Clock, Play, Filter, SortAsc, SortDesc, CheckCircle2 } from "lucide-react";
import { AssetKey, AssetVersion } from "../../../shared/types/index.js";
import { useStore } from "#/lib/store.js";
import {
    getAllAssetVersions,
    isAssetEvaluated,
    getAssetQualityScore,
} from "../../../shared/utils/assets-utils.js";

// ============================================================================
// TYPES
// ============================================================================

interface AssetHistoryPickerProps {
    sceneId: string;
    assetType: AssetKey;
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (asset: AssetVersion) => void;
    currentUrl?: string;
}

type SortOption = 'newest' | 'oldest' | 'quality-high' | 'quality-low';
type FilterOption = 'all' | 'evaluated' | 'unevaluated';

// ============================================================================
// MEMOIZED SUB-COMPONENTS
// ============================================================================

/**
 * Individual asset card - memoized to prevent unnecessary re-renders
 */
const AssetCard = memo(function AssetCard({
    asset,
    assetType,
    isCurrent,
    onClick,
}: {
    asset: AssetVersion;
    assetType: AssetKey;
    isCurrent: boolean;
    onClick: () => void;
}) {
    const qualityScore = getAssetQualityScore(asset);
    const hasEvaluation = isAssetEvaluated(asset);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div
                    className={ `group relative border rounded-md overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary ${isCurrent ? "ring-2 ring-primary" : ""
                        }` }
                    onClick={ onClick }
                >
                    <div className="aspect-video bg-muted relative">
                        { assetType === "scene_video" ? (
                            <div className="w-full h-full flex items-center justify-center relative">
                                <video
                                    src={ asset.data }
                                    preload="none"
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/10 transition-colors">
                                    <Play className="w-8 h-8 text-white opacity-80" />
                                </div>
                            </div>
                        ) : (
                            <img
                                src={ asset.data }
                                alt={ `Version ${asset.version}` }
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover"
                            />
                        ) }

                        {/* Badges */ }
                        <div className="absolute top-2 left-2 flex flex-col gap-1">
                            <Badge
                                variant="secondary"
                                className="text-[10px] bg-black/50 text-white backdrop-blur-sm border-white/20"
                            >
                                #{ asset.version }
                            </Badge>
                            { hasEvaluation && qualityScore !== undefined && (
                                <Badge
                                    variant="secondary"
                                    className="text-[10px] bg-black/50 text-white backdrop-blur-sm border-white/20"
                                >
                                    { (qualityScore * 100).toFixed(0) }%
                                </Badge>
                            ) }
                        </div>

                        { isCurrent && (
                            <div className="absolute top-2 right-2">
                                <Badge variant="default" className="text-[10px]">
                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                    Current
                                </Badge>
                            </div>
                        ) }
                    </div>

                    <div className="p-2 text-xs text-muted-foreground bg-card">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1 truncate">
                                <Clock className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">
                                    { new Date(asset.createdAt).toLocaleString(undefined, {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    }) }
                                </span>
                            </div>
                            { asset.metadata?.model && (
                                <span className="text-[10px] text-muted-foreground/70 truncate">
                                    { asset.metadata.model }
                                </span>
                            ) }
                        </div>
                    </div>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <div className="space-y-1">
                    <div>Version { asset.version } - Click to restore</div>
                    { hasEvaluation && qualityScore !== undefined && (
                        <div className="text-xs text-muted-foreground">
                            Quality: { (qualityScore * 100).toFixed(1) }%
                        </div>
                    ) }
                </div>
            </TooltipContent>
        </Tooltip>
    );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AssetHistoryPicker({
    sceneId,
    assetType,
    projectId,
    isOpen,
    onOpenChange,
    onSelect,
    currentUrl,
}: AssetHistoryPickerProps) {
    // State
    const [ assets, setAssets ] = useState<AssetVersion[]>([]);
    const [ isLoading, setIsLoading ] = useState(false);
    const [ error, setError ] = useState<string | null>(null);
    const [ sortBy, setSortBy ] = useState<SortOption>('newest');
    const [ filterBy, setFilterBy ] = useState<FilterOption>('all');

    // Store integration
    const getCachedAssets = useStore((state) => state.getCachedAssets);
    const cacheAssets = useStore((state) => state.cacheAssets);
    const ignoreUrls = useStore((state) => state.ignoreAssetUrls);

    // Load assets with caching
    useEffect(() => {
        if (!isOpen) return;

        const loadAssets = async () => {
            setIsLoading(true);
            setError(null);

            try {
                // Check cache first
                const cached = getCachedAssets(sceneId);
                if (cached) {
                    const versions = getAllAssetVersions(cached, assetType);
                    setAssets(versions);
                    setIsLoading(false);
                    return;
                }

                // Fetch from API
                const data = await getSceneAssets(projectId, sceneId);

                // Cache the full registry
                cacheAssets(sceneId, 'scene', data);

                // Extract versions for this asset type
                const versions = getAllAssetVersions(data, assetType);
                setAssets(versions);
            } catch (err) {
                console.error("Failed to load assets:", err);
                setError("Failed to load asset history.");
            } finally {
                setIsLoading(false);
            }
        };

        loadAssets();
    }, [ isOpen, projectId, sceneId, assetType, getCachedAssets, cacheAssets ]);

    // Filtered assets
    const filteredAssets = useMemo(() => {
        let filtered = assets;

        // Apply filter
        if (filterBy === 'evaluated') {
            filtered = filtered.filter((a) => isAssetEvaluated(a));
        } else if (filterBy === 'unevaluated') {
            filtered = filtered.filter((a) => !isAssetEvaluated(a));
        }

        // Filter out ignored URLs
        filtered = filtered.filter((a) => !ignoreUrls.has(a.data));

        return filtered;
    }, [ assets, filterBy, ignoreUrls ]);

    // Sorted assets
    const sortedAssets = useMemo(() => {
        const sorted = [ ...filteredAssets ];

        switch (sortBy) {
            case 'newest':
                sorted.sort((a, b) => b.version - a.version);
                break;
            case 'oldest':
                sorted.sort((a, b) => a.version - b.version);
                break;
            case 'quality-high':
                sorted.sort((a, b) => {
                    const scoreA = getAssetQualityScore(a) ?? -1;
                    const scoreB = getAssetQualityScore(b) ?? -1;
                    return scoreB - scoreA;
                });
                break;
            case 'quality-low':
                sorted.sort((a, b) => {
                    const scoreA = getAssetQualityScore(a) ?? Infinity;
                    const scoreB = getAssetQualityScore(b) ?? Infinity;
                    return scoreA - scoreB;
                });
                break;
        }

        return sorted;
    }, [ filteredAssets, sortBy ]);

    // Handlers
    const handleSelect = useCallback(
        (asset: AssetVersion) => {
            onSelect(asset);
            onOpenChange(false);
        },
        [ onSelect, onOpenChange ]
    );

    // Asset type display name
    const displayName = useMemo(() => {
        switch (assetType) {
            case 'scene_start_frame':
                return 'Start Frame';
            case 'scene_end_frame':
                return 'End Frame';
            case 'scene_video':
                return 'Video';
            default:
                return assetType.replace(/_/g, ' ');
        }
    }, [ assetType ]);

    return (
        <Dialog open={ isOpen } onOpenChange={ onOpenChange }>
            <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <DialogTitle>
                            { displayName } History
                            { sortedAssets.length > 0 && (
                                <span className="ml-2 text-sm font-normal text-muted-foreground">
                                    ({ sortedAssets.length } { sortedAssets.length === 1 ? 'version' : 'versions' })
                                </span>
                            ) }
                        </DialogTitle>

                        {/* Controls */ }
                        <div className="flex items-center gap-2">
                            {/* Filter */ }
                            <div className="flex items-center gap-1 border rounded-md">
                                <Button
                                    variant={ filterBy === 'all' ? 'secondary' : 'ghost' }
                                    size="sm"
                                    onClick={ () => setFilterBy('all') }
                                    className="h-8 px-2"
                                >
                                    <Filter className="w-3 h-3 mr-1" />
                                    All
                                </Button>
                                <Button
                                    variant={ filterBy === 'evaluated' ? 'secondary' : 'ghost' }
                                    size="sm"
                                    onClick={ () => setFilterBy('evaluated') }
                                    className="h-8 px-2"
                                >
                                    Evaluated
                                </Button>
                                <Button
                                    variant={ filterBy === 'unevaluated' ? 'secondary' : 'ghost' }
                                    size="sm"
                                    onClick={ () => setFilterBy('unevaluated') }
                                    className="h-8 px-2"
                                >
                                    Unevaluated
                                </Button>
                            </div>

                            {/* Sort */ }
                            <div className="flex items-center gap-1 border rounded-md">
                                <Button
                                    variant={ sortBy === 'newest' ? 'secondary' : 'ghost' }
                                    size="sm"
                                    onClick={ () => setSortBy('newest') }
                                    className="h-8 px-2"
                                >
                                    <SortDesc className="w-3 h-3 mr-1" />
                                    Newest
                                </Button>
                                <Button
                                    variant={ sortBy === 'oldest' ? 'secondary' : 'ghost' }
                                    size="sm"
                                    onClick={ () => setSortBy('oldest') }
                                    className="h-8 px-2"
                                >
                                    <SortAsc className="w-3 h-3 mr-1" />
                                    Oldest
                                </Button>
                                <Button
                                    variant={ sortBy.startsWith('quality') ? 'secondary' : 'ghost' }
                                    size="sm"
                                    onClick={ () =>
                                        setSortBy(sortBy === 'quality-high' ? 'quality-low' : 'quality-high')
                                    }
                                    className="h-8 px-2"
                                >
                                    Quality
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                <ScrollArea className="flex-1 p-1">
                    { isLoading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            { Array.from({ length: 8 }).map((_, i) => (
                                <div key={ i } className="space-y-2">
                                    <Skeleton className="aspect-video w-full rounded-md" />
                                    <Skeleton className="h-4 w-3/4" />
                                </div>
                            )) }
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center h-full text-destructive">
                            { error }
                        </div>
                    ) : sortedAssets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                            <p>No { filterBy === 'all' ? '' : filterBy } versions found.</p>
                            { filterBy !== 'all' && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={ () => setFilterBy('all') }
                                >
                                    Show All Versions
                                </Button>
                            ) }
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-4">
                            { sortedAssets.map((asset) => (
                                <AssetCard
                                    key={ asset.version }
                                    asset={ asset }
                                    assetType={ assetType }
                                    isCurrent={ currentUrl === asset.data }
                                    onClick={ () => handleSelect(asset) }
                                />
                            )) }
                        </div>
                    ) }
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}