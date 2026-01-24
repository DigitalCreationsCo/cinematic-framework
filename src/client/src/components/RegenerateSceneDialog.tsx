import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "#/components/ui/dialog";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { useEffect, useState } from "react";
import { Scene } from "#shared/types/workflow.types";
import { getAllBestFromAssets } from "#shared/utils/utils";

interface RegenerateSceneDialogProps {
    scene: Scene;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (prompt: string) => void;
}

export function RegenerateSceneDialog({
    scene,
    isOpen,
    onOpenChange,
    onSubmit,
}: RegenerateSceneDialogProps) {

    const assets = getAllBestFromAssets(scene.assets);
    const [ prompt, setPrompt ] = useState(assets[ 'scene_prompt' ]?.data || "");

    useEffect(() => {
        if (isOpen) {
            setPrompt(assets[ 'scene_prompt' ]?.data || "");
        }
    }, [ scene, isOpen ]);

    const handleSubmit = () => {
        onSubmit(prompt);
        onOpenChange(false);
    };

    return (
        <Dialog open={ isOpen } onOpenChange={ onOpenChange }>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Regenerate Scene { scene.id }</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Prompt
                        </label>
                        <Textarea
                            value={ prompt }
                            rows={ 10 }
                            onChange={ (e) => setPrompt(e.target.value) }
                            placeholder="Enter a new prompt for the scene..."
                            className="font-mono text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                            Modify the prompt to guide the regeneration.
                            Note: If you want to exclude a specific frame (Start/End) from the generation context,
                            please delete it from the preview first.
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={ () => onOpenChange(false) }>
                        Cancel
                    </Button>
                    <Button onClick={ () => { confirm('Are you sure you want to regenerate this scene?') && handleSubmit(); } }>
                        Regenerate
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
