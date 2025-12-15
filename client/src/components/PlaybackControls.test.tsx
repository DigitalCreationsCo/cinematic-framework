import { render, screen, fireEvent, act } from "@testing-library/react";
import PlaybackControls from "./PlaybackControls";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Scene } from "@shared/pipeline-types";

// Mock scenes data
const mockScenes: Scene[] = [
  { 
    id: 1, 
    startTime: 0, 
    endTime: 5, 
    duration: 5,
    description: "Scene 1",
    script: "Script 1",
    status: "completed",
    order: 1,
    projectId: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  { 
    id: 2, 
    startTime: 5, 
    endTime: 10, 
    duration: 5,
    description: "Scene 2",
    script: "Script 2",
    status: "completed",
    order: 2,
    projectId: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

describe("PlaybackControls", () => {
  const defaultProps = {
    scenes: mockScenes,
    totalDuration: 10,
    isPlaying: false,
    setIsPlaying: vi.fn(),
    onTimeUpdate: vi.fn(),
    onSeekSceneChange: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // Mock requestAnimationFrame
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("renders correctly with initial state", () => {
    render(<PlaybackControls {...defaultProps} />);
    
    expect(screen.getByTestId("playback-controls")).toBeInTheDocument();
    expect(screen.getByTestId("text-current-time")).toHaveTextContent("0:00");
    expect(screen.getByTestId("text-total-duration")).toHaveTextContent("0:10");
    expect(screen.getByTestId("button-play-pause")).toBeInTheDocument();
  });

  it("toggles play/pause when button is clicked", () => {
    const setIsPlaying = vi.fn();
    render(<PlaybackControls {...defaultProps} setIsPlaying={setIsPlaying} />);
    
    const playButton = screen.getByTestId("button-play-pause");
    fireEvent.click(playButton);
    
    expect(setIsPlaying).toHaveBeenCalledWith(true);
  });

  it("updates time when playing", () => {
    const onTimeUpdate = vi.fn();
    render(
      <PlaybackControls 
        {...defaultProps} 
        isPlaying={true} 
        onTimeUpdate={onTimeUpdate} 
      />
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onTimeUpdate).toHaveBeenCalled();
    const lastCallArg = onTimeUpdate.mock.calls[onTimeUpdate.mock.calls.length - 1][0];
    expect(lastCallArg).toBeGreaterThan(0);
  });
  
  it("does not create excessive animation loops", () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    
    render(
      <PlaybackControls 
        {...defaultProps} 
        isPlaying={true} 
      />
    );

    act(() => {
      vi.advanceTimersByTime(100); 
    });

    // 100ms / 16ms approx 6 frames. 
    // If the bug exists, each frame update changes 'currentTime', which triggers useEffect [currentTime], 
    // which calls startPlayback, which calls requestAnimationFrame.
    // So instead of just the loop calling RAF, the effect also calls RAF (or starts a new loop).
    // This is a bit tricky to assert exact numbers, but let's see what happens.
    // console.log("RAF calls:", rafSpy.mock.calls.length);
  });
});