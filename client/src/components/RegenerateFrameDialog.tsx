import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import { Scene } from "@shared/pipeline-types";

interface RegenerateFrameDialogProps {
    scene: Scene;
    frameToRegenerate: "start" | "end" | null;
    isOpen: boolean;
    onOpenChange: () => void;
    onSubmit: (prompt: string, originalPrompt: string) => void;
    originalPrompt?: string;
}

export function RegenerateFrameDialog({
    scene,
    frameToRegenerate,
    isOpen,
    onOpenChange,
    onSubmit,
}: RegenerateFrameDialogProps) {
    
    const originalPrompt = (frameToRegenerate === "start"
        ? scene.startFramePrompt
        : scene.endFramePrompt) || "";
    
    const [ prompt, setPrompt ] = useState(originalPrompt);

    useEffect(() => {
        setPrompt((frameToRegenerate === "start"
            ? scene.startFramePrompt
            : scene.endFramePrompt) || "");
    }, [ scene, frameToRegenerate, isOpen, onOpenChange, onSubmit ]);

    const handleSubmit = () => {
        onSubmit(prompt, originalPrompt);
        onOpenChange();
    };

    return (
        <Dialog open={ isOpen } onOpenChange={ onOpenChange }>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="capitalize">{ `Regenerate ${frameToRegenerate} Frame (Scene ${scene.id})` }</DialogTitle>
                </DialogHeader>
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Prompt
                </label>
                <Textarea
                    value={ prompt }
                    rows={ 10 }
                    onChange={ (e) => setPrompt(e.target.value) }
                    placeholder="Enter a new prompt for the frame..."
                />
                <DialogFooter>
                    <Button variant="ghost" onClick={ onOpenChange }>
                        Cancel
                    </Button>
                    <Button onClick={ () => { confirm('Are you sure you want to regenerate the image?') && handleSubmit(); } }>Regenerate</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}