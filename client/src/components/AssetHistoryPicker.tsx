import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { getSceneAssets } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Play } from "lucide-react";

interface Asset {
    attempt: number;
    url: string;
    timestamp: string;
}

interface AssetHistoryPickerProps {
    sceneId: number;
    assetType: "startFrame" | "endFrame" | "video";
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (asset: Asset) => void;
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
    const [ assets, setAssets ] = useState<Asset[]>([]);
    const [ isLoading, setIsLoading ] = useState(false);
    const [ error, setError ] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            setError(null);
            getSceneAssets(projectId, sceneId)
                .then((data) => {
                    if (assetType === "startFrame") setAssets(data.startFrames);
                    else if (assetType === "endFrame") setAssets(data.endFrames);
                    else if (assetType === "video") setAssets(data.videos);
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
                        History: { assetType === "startFrame" ? "Start Frame" : assetType === "endFrame" ? "End Frame" : "Video" } (Scene { sceneId })
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
                                const isCurrent = currentUrl && asset.url === currentUrl;
                                return (
                                    <Tooltip key={ asset.attempt }>
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
                                                    { assetType === "video" ? (
                                                        <div className="w-full h-full flex items-center justify-center relative">
                                                            <video
                                                                src={ asset.url }
                                                                preload="auto"
                                                                className="w-full h-full object-cover" />
                                                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/10 transition-colors">
                                                                <Play className="w-8 h-8 text-white opacity-80" />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                            <img
                                                                src={ asset.url } 
                                                                alt={ `Attempt ${asset.attempt}` } 
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
                                                            #{ asset.attempt }
                                                        </Badge>
                                                    </div>
                                                </div>
                                                <div className="p-2 text-xs text-muted-foreground bg-card">
                                                    <div className="flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        <span>{ formatTime(asset.timestamp) }</span>
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
