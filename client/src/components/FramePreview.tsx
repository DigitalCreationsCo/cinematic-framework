import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { memo } from "react";

interface FramePreviewProps {
  title: string;
  imageUrl?: string;
  alt: string;
  isLoading?: boolean;
  onRegenerate?: () => void;
  isGenerating: boolean;
}

const FramePreview = memo(function FramePreview({ title, imageUrl, alt, isLoading, onRegenerate, isGenerating }: FramePreviewProps) {
  return (
    <Card data-testid={ `frame-preview-${title.toLowerCase().replace(/\s+/g, '-')}` }>
      <CardHeader className="p-3 pb-2 flex-row items-center justify-between">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          { isLoading ? <Skeleton className="h-4 w-24" /> : title }
        </CardTitle>
        { onRegenerate && !isLoading && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={ () => { confirm('Are you sure you want to regenerate the image?') && onRegenerate(); } }>
            <RefreshCw className="h-3 w-3" />
            <span className="sr-only">Regenerate</span>
          </Button>
        ) }
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="aspect-video bg-muted rounded-md overflow-hidden">
          { isLoading ? (
            <Skeleton className="w-full h-full" />
          ) : imageUrl ? (
            <img
              src={ imageUrl }
              alt={ alt }
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
            </div>
          ) }
        </div>
      </CardContent>
    </Card>
  );
});

export default FramePreview;
