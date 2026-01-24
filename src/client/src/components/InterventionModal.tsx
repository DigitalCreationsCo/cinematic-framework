import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '#/components/ui/dialog';
import { Button } from '#/components/ui/button';
import { useStore } from '#/lib/store';
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { Textarea } from '#/components/ui/textarea';
import { resolveIntervention, resumePipeline } from '#/lib/api';

export function InterventionModal() {
    const { interruptionState, setInterruptionState, setProjectStatus, selectedProject, setIsLoading } = useStore();
    const [ paramsJson, setParamsJson ] = useState('');
    const [ jsonError, setJsonError ] = useState<string | null>(null);

    useEffect(() => {
        if (interruptionState) {
            setParamsJson(JSON.stringify(interruptionState.currentParams, null, 2));
        }
    }, [ interruptionState ]);

    const handleResolve = async (action: 'retry' | 'skip' | 'abort', revisedParams?: any) => {
        if (!selectedProject) return;

        try {
            await resolveIntervention({
                projectId: selectedProject,
                payload: { action, revisedParams }
            });

            setProjectStatus("analyzing");
            setIsLoading(false);
            setInterruptionState(null);
        } catch (error) {
            console.error('Error resolving intervention:', error);
            // Maybe show toast error
        }
    };

    const handleRetryWithChanges = () => {
        try {
            const parsed = JSON.parse(paramsJson);
            handleResolve('retry', parsed);
        } catch (e) {
            setJsonError((e as Error).message);
        }
    };

    if (!interruptionState) return null;

    return (
        <Dialog open={ !!interruptionState } onOpenChange={ (open) => !open && handleResolve('abort') }>
            <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Human Intervention Required</DialogTitle>
                    <DialogDescription>
                        An error occurred during { interruptionState.functionName || 'LLM execution' }.
                        Please review the error and parameters.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-4 space-y-4">
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription className="font-mono text-xs whitespace-pre-wrap">
                            { interruptionState.error }
                        </AlertDescription>
                    </Alert>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Parameters (JSON)</label>
                        <Textarea
                            value={ paramsJson }
                            onChange={ (e) => {
                                setParamsJson(e.target.value);
                                setJsonError(null);
                            } }
                            className="font-mono text-xs h-[300px]"
                        />
                        { jsonError && (
                            <p className="text-destructive text-xs">{ jsonError }</p>
                        ) }
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={ () => handleResolve('abort') }>
                        Cancel Operation
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={ () => handleResolve('retry') }>
                            Retry Original
                        </Button>
                        <Button onClick={ handleRetryWithChanges }>
                            Retry with Changes
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
