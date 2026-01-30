import { useState, useRef, useEffect, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { Button } from "#/components/ui/button.js";
import { Slider } from "#/components/ui/slider.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.js";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Maximize,
  X,
  Volume,
  Volume1,
} from "lucide-react";
import { cn } from "#/lib/utils.js";
import type { Scene } from "../../../shared/types/index.js";
import { Skeleton } from "#/components/ui/skeleton.js";

interface PlaybackControlsProps {
  scenes: Scene[];
  totalDuration: number;
  videoSrc?: string;
  playbackOffset?: number;
  onTimeUpdate?: (time: number) => void;
  onPlayMainVideo?: () => void;
  isLoading?: boolean;
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  selectedSceneIndex?: number;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const PlaybackControls = memo(function PlaybackControls({
  scenes,
  totalDuration,
  videoSrc,
  playbackOffset = 0,
  onTimeUpdate,
  onPlayMainVideo,
  isLoading,
  isPlaying,
  setIsPlaying,
  selectedSceneIndex,
}: PlaybackControlsProps) {
  const [ currentTime, setCurrentTime ] = useState(0);
  const [ volume, setVolume ] = useState(0.8);
  const [ isMuted, setIsMuted ] = useState(false);
  const [ isLooping, setIsLooping ] = useState(false);
  const [ isTheatreMode, setIsTheatreMode ] = useState(false);
  const theatreVideoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const getSceneAtTime = useCallback((time: number): Scene | undefined => {
    return scenes.find(s => time >= s.startTime && time < s.endTime);
  }, [ scenes ]);

  const playbackScene = isPlaying
    ? getSceneAtTime(currentTime)
    : (scenes.find(s => s.sceneIndex === selectedSceneIndex) || getSceneAtTime(currentTime));

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Main animation loop
  useEffect(() => {
    if (!isPlaying || !videoSrc) {
      return;
    }

    lastTimeRef.current = performance.now();

    const animate = (timestamp: number) => {
      const delta = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      // Prevent large jumps or negative deltas
      if (delta < 0 || delta > 0.5) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      setCurrentTime(prev => {
        const newTime = prev + delta;

        if (newTime >= totalDuration) {
          if (isLooping) {
            return 0;
          } else {
            // Need to stop
            setTimeout(() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }, 0);
            return totalDuration;
          }
        }
        return newTime;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [ isPlaying, totalDuration, isLooping, setIsPlaying ]);

  // Synchronize media elements
  useEffect(() => {
    // Only sync theatre video if in theatre mode
    if (isTheatreMode && theatreVideoRef.current) {
      const videoTime = Math.max(0, currentTime - playbackOffset);
      // Sync if drift is significant (e.g. seek or scene change)
      if (Math.abs(theatreVideoRef.current.currentTime - videoTime) > 0.2) {
        theatreVideoRef.current.currentTime = videoTime;
      }
      if (isPlaying) theatreVideoRef.current.play().catch(() => { });
      else theatreVideoRef.current.pause();
    }
  }, [ currentTime, isPlaying, playbackOffset, theatreVideoRef, isTheatreMode ]);

  // Update time for external consumers (like Timeline)
  useEffect(() => {
    onTimeUpdate?.(currentTime);
  }, [ currentTime, onTimeUpdate ]);

  const handlePlayPause = () => {
    if (onPlayMainVideo) {
      onPlayMainVideo();
    }
    const willPlay = !isPlaying;
    setIsPlaying(willPlay);
    if (willPlay) {
      setIsTheatreMode(true);
    }
  };

  const handleSeek = (value: number[]) => {
    const newTime = value[ 0 ];
    setCurrentTime(newTime);
  };

  const handleSkipBack = () => {
    const currentScene = getSceneAtTime(currentTime);
    if (!currentScene) {
      const newTime = 0;
      setCurrentTime(newTime);
      return;
    }

    const currentIndex = scenes.findIndex(s => s.id === currentScene.id);
    let newTime = 0;
    if (currentIndex > 0) {
      const prevScene = scenes[ currentIndex - 1 ];
      newTime = prevScene.startTime;
    }

    setCurrentTime(newTime);
  };

  const handleSkipForward = () => {
    const currentScene = getSceneAtTime(currentTime);
    if (!currentScene) return;

    const currentIndex = scenes.findIndex(s => s.id === currentScene.id);
    if (currentIndex < scenes.length - 1) {
      const nextScene = scenes[ currentIndex + 1 ];
      const newTime = nextScene.startTime;
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[ 0 ];
    setVolume(newVolume);
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }

    if (theatreVideoRef?.current) {
      theatreVideoRef.current.volume = isMuted ? 0 : newVolume;
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const toggleLoop = () => {
    setIsLooping(!isLooping);
  };

  if (isLoading) {
    return (
      <div className="bg-card border rounded-md p-3 space-y-3" data-testid="playback-controls-skeleton">
        <Skeleton className="h-4 w-full" />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-md py-3 px-6 space-y-3" data-testid="playback-controls">
      <div className="relative">
        <div className="absolute -top-1 left-0 right-0 h-1 flex">
          { scenes.map((scene) => {
            const left = (scene.startTime / totalDuration) * 100;
            const width = (scene.duration / totalDuration) * 100;
            const isPlaybackScene = playbackScene?.id === scene.id;

            return (
              <div
                key={ scene.id }
                className={ cn(
                  "absolute h-full transition-opacity",
                  isPlaybackScene ? "opacity-100" : "opacity-30"
                ) }
                style={ {
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: isPlaybackScene ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'
                } }
              />
            );
          }) }
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Slider
              value={ [ currentTime ] }
              min={ 0 }
              max={ totalDuration }
              step={ 0.1 }
              onValueChange={ handleSeek }
              className="mt-2"
              data-testid="seekbar"
            />
          </TooltipTrigger>
          <TooltipContent>Seek</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono justify-center">
          <span data-testid="text-current-time">{ formatTime(currentTime) }</span>
          <span>/</span>
          <span data-testid="text-total-duration">{ formatTime(totalDuration) }</span>
          { playbackScene && (
            <span className="ml-2 text-foreground">
              Playhead: Scene #{ playbackScene.id }
            </span>
          ) }
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={ handleSkipBack }
                data-testid="button-skip-back"
              >
                <SkipBack className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Previous Scene</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                onClick={ handlePlayPause }
                data-testid="button-play-pause"
                disabled={ !videoSrc || isLoading }
              >
                { isPlaying ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                ) }
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ isPlaying ? "Pause" : "Play" }</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={ handleSkipForward }
                data-testid="button-skip-forward"
              >
                <SkipForward className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Next Scene</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={ toggleLoop }
                className={ cn(isLooping && "text-primary") }
                data-testid="button-loop"
              >
                <Repeat className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle Loop</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={ () => setIsTheatreMode(true) }
                data-testid="button-theatre-mode"
              >
                <Maximize className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Theatre Mode</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={ toggleMute }
                data-testid="button-mute"
              >
                { (isMuted || volume === 0 && <Volume className="w-4 h-4" />) ||
                  (volume < 0.44 && <Volume1 className="w-4 h-4" />) ||
                  (<Volume2 className="w-4 h-4" />)
                }
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ isMuted ? "Unmute" : "Mute" }</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Slider
                value={ [ isMuted ? 0 : volume ] }
                min={ 0 }
                max={ 1 }
                step={ 0.01 }
                onValueChange={ handleVolumeChange }
                className="w-20 cursor-pointer"
                data-testid="volume-slider"
              />
            </TooltipTrigger>
            <TooltipContent>Volume</TooltipContent>
          </Tooltip>
        </div>
      </div>

      { isTheatreMode && createPortal(
        <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden">
          <Button
            size="icon"
            variant="ghost"
            className="absolute top-4 right-4 text-white hover:bg-white/20 z-50"
            onClick={ () => setIsTheatreMode(false) }
          >
            <X className="w-6 h-6" />
          </Button>

          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={ theatreVideoRef }
              src={ videoSrc || undefined }
              className="max-h-full max-w-full"
              onClick={ handlePlayPause }
              playsInline
            />

            {/* Minimal Overlay Controls */ }
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/60 px-6 py-3 rounded-full backdrop-blur-md opacity-0 hover:opacity-100 transition-opacity duration-300">
              <Button
                size="icon"
                variant="ghost"
                onClick={ handleSkipBack }
                className="text-white hover:bg-white/20"
              >
                <SkipBack className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={ handlePlayPause }
                className="text-white hover:bg-white/20 scale-125"
              >
                { isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" /> }
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={ handleSkipForward }
                className="text-white hover:bg-white/20"
              >
                <SkipForward className="w-5 h-5" />
              </Button>

              <div className="w-px h-6 bg-white/20 mx-2" />

              <span className="text-xs text-white/90 font-mono">
                { formatTime(currentTime) } / { formatTime(totalDuration) }
              </span>
            </div>
          </div>
        </div>,
        document.body
      ) }
    </div>
  );
});

export default PlaybackControls;
