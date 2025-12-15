import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Maximize,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Scene } from "@shared/pipeline-types";
import { Skeleton } from "@/components/ui/skeleton";

interface PlaybackControlsProps {
  scenes: Scene[];
  totalDuration: number;
  audioUrl?: string;
  videoSrc?: string;
  mainVideoRef?: React.RefObject<HTMLVideoElement>;
  playbackOffset?: number;
  timelineVideoRefs?: React.RefObject<HTMLVideoElement>[];
  onSeekSceneChange?: (sceneId: number) => void;
  onTimeUpdate?: (time: number) => void;
  onPlayMainVideo?: () => void;
  isLoading?: boolean;
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const PlaybackControls = memo(function PlaybackControls({
  scenes,
  totalDuration,
  audioUrl,
  mainVideoRef,
  videoSrc,
  playbackOffset = 0,
  timelineVideoRefs,
  onSeekSceneChange,
  onTimeUpdate,
  onPlayMainVideo,
  isLoading,
  isPlaying,
  setIsPlaying,
}: PlaybackControlsProps) {
  const [ currentTime, setCurrentTime ] = useState(0);
  const [ volume, setVolume ] = useState(0.8);
  const [ isMuted, setIsMuted ] = useState(false);
  const [ isLooping, setIsLooping ] = useState(false);
  const [ isTheatreMode, setIsTheatreMode ] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const theatreVideoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const lastSceneIdRef = useRef<number | null>(null);

  const getSceneAtTime = useCallback((time: number): Scene | undefined => {
    return scenes.find(s => time >= s.startTime && time < s.endTime);
  }, [ scenes ]);

  const playbackScene = getSceneAtTime(currentTime);

  useEffect(() => {
    if (audioUrl) {
      if (!audioRef.current) {
        audioRef.current = new Audio(audioUrl);
      } else if (audioRef.current.src !== audioUrl && !audioUrl.endsWith(audioRef.current.src)) {
        // Only update if different (handling relative vs absolute path differences if necessary)
        // Simple check:
        if (!audioRef.current.src.includes(audioUrl)) {
          audioRef.current.src = audioUrl;
        }
      }
      audioRef.current.volume = isMuted ? 0 : volume;
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      // Don't nullify audioRef here to allow persistence, but we should pause if component unmounts
      // Actually, if we re-mount, we might want a new audio.
      // But if audioUrl changes, we handle it above.
    };
  }, [ audioUrl ]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Handle user audio volume/mute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [ volume, isMuted ]);

  // Handle user audio loop
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.loop = isLooping;
    }
  }, [ isLooping ]);

  // Main animation loop
  useEffect(() => {
    if (!isPlaying) {
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
    if (audioRef.current) {
      if (Math.abs(audioRef.current.currentTime - currentTime) > 0.2) {
        audioRef.current.currentTime = currentTime;
      }
      if (isPlaying) audioRef.current.play().catch(() => { });
      else audioRef.current.pause();
    }

    const activeVideoRef = isTheatreMode ? theatreVideoRef : mainVideoRef;
    const inactiveVideoRef = isTheatreMode ? mainVideoRef : theatreVideoRef;

    if (activeVideoRef?.current) {
      const videoTime = Math.max(0, currentTime - playbackOffset);
      // Sync if drift is significant (e.g. seek or scene change)
      if (Math.abs(activeVideoRef.current.currentTime - videoTime) > 0.2) {
        activeVideoRef.current.currentTime = videoTime;
      }
      if (isPlaying) activeVideoRef.current.play().catch(() => { });
      else activeVideoRef.current.pause();
    }

    if (inactiveVideoRef?.current) {
      inactiveVideoRef.current.pause();
    }
  }, [ currentTime, isPlaying, playbackOffset, mainVideoRef, theatreVideoRef, isTheatreMode, audioUrl ]);

  // Update time for external consumers (like Timeline) and trigger scene change notification
  useEffect(() => {
    onTimeUpdate?.(currentTime);

    // Seek all managed video elements (if they are not in a loop, they will react to currentTime change)
    if (timelineVideoRefs) {
      timelineVideoRefs.forEach(ref => {
        if (ref.current) {
          ref.current.currentTime = currentTime;
        }
      });
    }

    if (playbackScene && playbackScene.id !== lastSceneIdRef.current) {
      lastSceneIdRef.current = playbackScene.id;
      onSeekSceneChange?.(playbackScene.id);
    }
  }, [ currentTime, playbackScene, onSeekSceneChange, onTimeUpdate, timelineVideoRefs ]);

  const handlePlayPause = () => {
    if (onPlayMainVideo) {
      onPlayMainVideo();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (value: number[]) => {
    const newTime = value[ 0 ];
    setCurrentTime(newTime);

    // Audio and Video sync handled by useEffect

    // Seek all timeline videos
    if (timelineVideoRefs) {
      timelineVideoRefs.forEach(ref => {
        if (ref.current) {
          ref.current.currentTime = newTime;
        }
      });
    }
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
    // Also apply volume to intrinsic video audio if no user audio is present
    if (!audioUrl) {
      if (mainVideoRef?.current) {
        mainVideoRef.current.volume = isMuted ? 0 : newVolume;
      }
      if (theatreVideoRef?.current) {
        theatreVideoRef.current.volume = isMuted ? 0 : newVolume;
      }
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
    <div className="bg-card border rounded-md p-3 space-y-3" data-testid="playback-controls">
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

        <Slider
          value={ [ currentTime ] }
          min={ 0 }
          max={ totalDuration }
          step={ 0.1 }
          onValueChange={ handleSeek }
          className="mt-2"
          data-testid="seekbar"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={ handleSkipBack }
            data-testid="button-skip-back"
          >
            <SkipBack className="w-4 h-4" />
          </Button>

          <Button
            size="icon"
            onClick={ handlePlayPause }
            data-testid="button-play-pause"
          >
            { isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            ) }
          </Button>

          <Button
            size="icon"
            variant="ghost"
            onClick={ handleSkipForward }
            data-testid="button-skip-forward"
          >
            <SkipForward className="w-4 h-4" />
          </Button>

          <Button
            size="icon"
            variant="ghost"
            onClick={ toggleLoop }
            className={ cn(isLooping && "text-primary") }
            data-testid="button-loop"
          >
            <Repeat className="w-4 h-4" />
          </Button>

          <Button
            size="icon"
            variant="ghost"
            onClick={ () => setIsTheatreMode(true) }
            data-testid="button-theatre-mode"
            title="Theatre Mode"
          >
            <Maximize className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono flex-1 justify-center">
          <span data-testid="text-current-time">{ formatTime(currentTime) }</span>
          <span>/</span>
          <span data-testid="text-total-duration">{ formatTime(totalDuration) }</span>
          { playbackScene && (
            <span className="ml-2 text-foreground">
              Playhead: Scene #{ playbackScene.id }
            </span>
          ) }
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={ toggleMute }
            data-testid="button-mute"
          >
            { isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            ) }
          </Button>

          <Slider
            value={ [ isMuted ? 0 : volume ] }
            min={ 0 }
            max={ 1 }
            step={ 0.01 }
            onValueChange={ handleVolumeChange }
            className="w-20"
            data-testid="volume-slider"
          />
        </div>
      </div>

      { isTheatreMode && (
        <div className="absolute top-0 left-0 h-screen w-screen z-50 bg-black flex items-center justify-center">
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
        </div>
      ) }
    </div>
  );
});

export default PlaybackControls;
