import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

interface RegenerateFrameDialogProps {
    isOpen: boolean;
    onOpenChange: () => void;
    onSubmit: (prompt: string, originalPrompt: string) => void;
    originalPrompt?: string;
}

export function RegenerateFrameDialog({
    isOpen,
    onOpenChange,
    onSubmit,
    originalPrompt = "",
}: RegenerateFrameDialogProps) {
    const [ prompt, setPrompt ] = useState(originalPrompt);

    const handleSubmit = () => {
        onSubmit(prompt, originalPrompt);
        onOpenChange();
    };

    return (
        <Dialog open={ isOpen } onOpenChange={ onOpenChange }>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Regenerate Frame</DialogTitle>
                </DialogHeader>
                <Textarea
                    value={ prompt }
                    onChange={ (e) => setPrompt(e.target.value) }
                    placeholder="Enter a new prompt for the frame..."
                />
                <DialogFooter>
                    <Button variant="ghost" onClick={ onOpenChange }>
                        Cancel
                    </Button>
                    <Button onClick={ handleSubmit }>Regenerate</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}