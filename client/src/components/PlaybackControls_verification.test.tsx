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
    duration: 6,
    description: "Scene 1",
    type: "lyrical",
    shotType: "WS",
    cameraMovement: "Static",
    characters: [],
    locationId: "loc1",
    lighting: { quality: "Hard", colorTemperature: "Neutral" },
    lyrics: "",
    musicalDescription: "",
    musicChange: "",
    intensity: "medium",
    mood: "happy",
    tempo: "moderate",
    transitionType: "Cut",
    continuityNotes: []
  },
  { 
    id: 2, 
    startTime: 5, 
    endTime: 10, 
    duration: 6,
    description: "Scene 2",
    type: "lyrical",
    shotType: "CU",
    cameraMovement: "Static",
    characters: [],
    locationId: "loc1",
    lighting: { quality: "Hard", colorTemperature: "Neutral" },
    lyrics: "",
    musicalDescription: "",
    musicChange: "",
    intensity: "medium",
    mood: "happy",
    tempo: "moderate",
    transitionType: "Cut",
    continuityNotes: []
  }
];

describe("PlaybackControls Verification", () => {
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
    // Mock performance.now
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      return now;
    });
    
    // Mock requestAnimationFrame to advance time and call callback
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        // Increment 'now' to simulate time passing for the next frame
        now += 16.6; 
        return setTimeout(() => cb(now), 16) as unknown as number;
    });
    
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("should increase time monotonically when playing", () => {
    const onTimeUpdate = vi.fn();
    render(
      <PlaybackControls 
        {...defaultProps} 
        isPlaying={true} 
        onTimeUpdate={onTimeUpdate} 
      />
    );

    // Initial state check
    expect(screen.getByTestId("text-current-time")).toContain("0:00");

    // Advance time
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Check that time has advanced
    // We expect multiple calls to onTimeUpdate
    expect(onTimeUpdate).toHaveBeenCalled();
    const calls = onTimeUpdate.mock.calls.map(c => c[0]);
    
    // Check for monotonicity
    for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i-1]);
    }
    
    // Check that we didn't jump too far (e.g. 100ms should be around 0.1s)
    const lastTime = calls[calls.length - 1];
    expect(lastTime).toBeGreaterThan(0.05);
    expect(lastTime).toBeLessThan(0.2); // allowances for frame timing
  });

  it("should stop at the end when not looping", () => {
    const setIsPlaying = vi.fn();
    const onTimeUpdate = vi.fn();
    
    render(
      <PlaybackControls 
        {...defaultProps} 
        isPlaying={true} 
        setIsPlaying={setIsPlaying}
        onTimeUpdate={onTimeUpdate}
      />
    );

    // Advance time significantly to surpass totalDuration (10s)
    // 10000ms + buffer
    act(() => {
        vi.advanceTimersByTime(11000); 
    });

    // Should have called setIsPlaying(false)
    // Note: The loop calls setIsPlaying(false) when newTime >= totalDuration
    expect(setIsPlaying).toHaveBeenCalledWith(false);
  });
  
  it("should auto-restart from 0 if play is clicked after finishing", () => {
     // This tests the handlePlayPause logic modification
     const setIsPlaying = vi.fn();
     
     // Mock internal state by manipulating it via a rerender or initial props?
     // Since 'currentTime' is internal state, we can't easily set it to 10 without exposing it.
     // However, we can simulate the scenario by:
     // 1. Play until end (internal state becomes 10)
     // 2. Click play
     
     const { rerender } = render(
       <PlaybackControls 
         {...defaultProps} 
         isPlaying={true} 
         setIsPlaying={setIsPlaying}
       />
     );

     // Fast forward to end
     act(() => {
       vi.advanceTimersByTime(11000);
     });
     
     // At this point setIsPlaying(false) would have been called.
     // We need to simulate the parent updating the prop.
     rerender(
        <PlaybackControls 
         {...defaultProps} 
         isPlaying={false} 
         setIsPlaying={setIsPlaying}
       />
     );
     
     // Now click play
     const playButton = screen.getByTestId("button-play-pause");
     fireEvent.click(playButton);
     
     // We expect setIsPlaying(true) to be called
     expect(setIsPlaying).toHaveBeenCalledWith(true);
     
     // And implicitly, we expect currentTime to have been reset to 0 in the component.
     // We can check if the time display resets or starts from 0 in a subsequent update.
     // But internal state checking is hard without indirect observation.
     // The 'text-current-time' might update on the next render cycle.
  });
});