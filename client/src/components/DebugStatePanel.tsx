import React, { useState } from "react";
import { useStore } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, ChevronRight, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface JsonNodeProps {
    label?: string;
    data: any;
    level?: number;
}

const JsonNode: React.FC<JsonNodeProps> = ({ label, data, level = 0 }) => {
    const [ isOpen, setIsOpen ] = useState(false);
    const isObject = data !== null && typeof data === "object";
    const isArray = Array.isArray(data);
    const isEmpty = isObject && Object.keys(data).length === 0;

    const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isEmpty) setIsOpen(!isOpen);
    };

    const indentClass = level > 0 ? "ml-4 border-l border-muted pl-2" : "";

    if (!isObject) {
        let valueColor = "text-foreground";
        if (typeof data === "string") valueColor = "text-green-500";
        if (typeof data === "number") valueColor = "text-orange-500";
        if (typeof data === "boolean") valueColor = "text-blue-500";
        if (data === null || data === undefined) valueColor = "text-muted-foreground";

        return (
            <div className={ `flex items-start font-mono text-xs py-0.5 ${indentClass}` }>
                { label && <span className="text-muted-foreground mr-2 select-none">{ label }:</span> }
                <span className={ `${valueColor} break-all` }>
                    { typeof data === 'string' ? `"${data}"` : String(data) }
                </span>
            </div>
        );
    }

    const keys = Object.keys(data);
    const itemCount = keys.length;
    const preview = isArray ? `Array(${itemCount})` : `Object {${itemCount}}`;

    return (
        <div className={ `font-mono text-xs ${indentClass}` }>
            <div
                className={ `flex items-center py-0.5 cursor-pointer hover:bg-muted/50 rounded select-none group` }
                onClick={ toggle }
            >
                <span className="w-4 h-4 mr-1 flex items-center justify-center text-muted-foreground">
                    { !isEmpty && (isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) }
                </span>
                { label && <span className="text-purple-500 mr-2 font-medium">{ label }:</span> }
                <span className="text-muted-foreground opacity-70 group-hover:opacity-100 transition-opacity">
                    { isEmpty ? (isArray ? "[]" : "{}") : preview }
                </span>
            </div>

            { isOpen && !isEmpty && (
                <div className="ml-2">
                    { keys.map((key) => (
                        <JsonNode
                            key={ key }
                            label={ key }
                            data={ data[ key ] }
                            level={ level + 1 }
                        />
                    )) }
                </div>
            ) }
        </div>
    );
};

// Wrapper for the root object
const JsonTree: React.FC<{ data: any; }> = ({ data }) => {
    return (
        <div className="space-y-1">
            { Object.entries(data).map(([ key, value ]) => (
                <JsonNode key={ key } label={ key } data={ value } level={ 0 } />
            )) }
        </div>
    );
};

export default function DebugStatePanel() {
    const store = useStore();
    const { toast } = useToast();

    // Filter out functions (actions) to show only state data
    const stateData = Object.fromEntries(
        Object.entries(store).filter(([ _, value ]) => typeof value !== 'function')
    );

    const handleCopy = () => {
        navigator.clipboard.writeText(JSON.stringify(stateData, null, 2));
        toast({
            title: "Copied to clipboard",
            description: "Full state JSON copied to clipboard",
        });
    };

    return (
        <div className="h-full p-4 select-text">
            <Card className="h-full flex flex-col">
                <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0 shrink-0">
                    <CardTitle className="text-sm font-semibold">Application State (Debug)</CardTitle>
                    <Button variant="ghost" size="sm" onClick={ handleCopy }>
                        <Copy className="w-4 h-4" />
                    </Button>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden">
                    <ScrollArea className="h-full w-full p-4">
                        <JsonTree data={ stateData } />
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
