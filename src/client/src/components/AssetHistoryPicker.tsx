import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip";
import { Badge } from "#/components/ui/badge";
import { useEffect, useState } from "react";
import { getSceneAssets } from "#/lib/api";
import { Skeleton } from "#/components/ui/skeleton";
import { Clock, Play } from "lucide-react";
import { AssetKey, AssetVersion } from "#shared/types/workflow.types";



interface AssetHistoryPickerProps {
    sceneId: string;
    assetType: AssetKey;
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (asset: AssetVersion) => void;
    currentUrl?: string;
}

export function AssetHistoryPicker({
    sceneId,
    assetType,
    projectId,
    isOpen,
    onOpenChange,
    onSelect,
    currentUrl
}: AssetHistoryPickerProps) {
    const [ assets, setAssets ] = useState<AssetVersion[]>([]);
    const [ isLoading, setIsLoading ] = useState(false);
    const [ error, setError ] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            setError(null);
            getSceneAssets(projectId, sceneId)
                .then((data) => {
                    if (assetType === "scene_start_frame") setAssets(Object.values(data?.[ 'scene_start_frame' ]?.versions || []));
                    else if (assetType === "scene_end_frame") setAssets(Object.values(data?.[ 'scene_end_frame' ]?.versions || []));
                    else if (assetType === "scene_video") setAssets(Object.values(data?.[ 'scene_video' ]?.versions || []));
                })
                .catch((err) => {
                    console.error("Failed to load assets:", err);
                    setError("Failed to load history.");
                })
                .finally(() => setIsLoading(false));
        }
    }, [ isOpen, projectId, sceneId, assetType ]);

    const formatTime = (isoString: string) => {
        try {
            return new Date(isoString).toLocaleString();
        } catch {
            return isoString;
        }
    };

    return (
        <Dialog open={ isOpen } onOpenChange={ onOpenChange }>
            <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>
                        History: { assetType === "scene_start_frame" ? "Start Frame" : assetType === "scene_end_frame" ? "End Frame" : "Video" } (Scene { sceneId })
                    </DialogTitle>
                </DialogHeader>

                <ScrollArea className="flex-1 p-1">
                    { isLoading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            { Array.from({ length: 6 }).map((_, i) => (
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
                    ) : assets.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            No history found for this asset.
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pb-4">
                            { assets.map((asset) => {
                                const isCurrent = currentUrl && asset.data === currentUrl;
                                return (
                                    <Tooltip key={ asset.version }>
                                        <TooltipTrigger asChild>
                                            <div
                                                className={ `group relative border rounded-md overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary ${isCurrent ? "ring-2 ring-primary" : ""
                                                    }` }
                                                onClick={ () => {
                                                    onSelect(asset);
                                                    onOpenChange(false);
                                                } }
                                            >
                                                <div className="aspect-video bg-muted relative">
                                                    { assetType === "scene_video" ? (
                                                        <div className="w-full h-full flex items-center justify-center relative">
                                                            <video
                                                                src={ asset.data }
                                                                preload="auto"
                                                                className="w-full h-full object-cover" />
                                                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/10 transition-colors">
                                                                <Play className="w-8 h-8 text-white opacity-80" />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <img
                                                            src={ asset.data }
                                                            alt={ `Attempt ${asset.version}` }
                                                            loading={ "eager" }
                                                            decoding="async"
                                                            fetchPriority={ "high" }
                                                            className="w-full h-full object-cover" />
                                                    ) }
                                                    { isCurrent && (
                                                        <div className="absolute top-2 right-2">
                                                            <Badge variant="default" className="text-[10px]">Current</Badge>
                                                        </div>
                                                    ) }
                                                    <div className="absolute top-2 left-2">
                                                        <Badge variant="secondary" className="text-[10px] bg-black/50 text-white backdrop-blur-sm border-white/20">
                                                            #{ asset.version }
                                                        </Badge>
                                                    </div>
                                                </div>
                                                <div className="p-2 text-xs text-muted-foreground bg-card">
                                                    <div className="flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        <span>{ formatTime(asset.createdAt.toISOString()) }</span>  
                                                    </div>
                                                </div>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>Restore this version</TooltipContent>
                                    </Tooltip>
                                );
                            }) }
                        </div>
                    ) }
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
