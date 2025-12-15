import { create } from 'zustand';
import { GraphState, Scene, PipelineStatus, PipelineMessage } from '@shared/pipeline-types';
import { immer } from 'zustand/middleware/immer';

type ConnectionStatus = "connected" | "disconnected" | "connecting";

interface AppState {
  // Project and Pipeline State
  selectedProject: string | null;
  pipelineState: GraphState | null;
  pipelineStatus: PipelineStatus;
  connectionStatus: ConnectionStatus;
  messages: PipelineMessage[];
  isHydrated: boolean;
  isLoading: boolean;
  error: string | null;

  // UI State
  selectedSceneId: number | null;
  currentPlaybackTime: number;
  isPlaying: boolean;
  isDark: boolean;
  activeTab: string;

  // Actions
  setSelectedProject: (projectId: string | null) => void;
  setPipelineState: (state: GraphState | null) => void;
  setPipelineStatus: (status: PipelineStatus) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setIsHydrated: (hydrated: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  addMessage: (message: PipelineMessage) => void;
  clearMessages: () => void;
  removeMessage: (id: string) => void;

  updateScene: (sceneId: number, updates: Partial<Scene & { status?: string; }>) => void;

  setSelectedSceneId: (id: number | null) => void;
  setCurrentPlaybackTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setIsDark: (isDark: boolean) => void;
  setActiveTab: (tab: string) => void;

  resetDashboard: () => void;
}

export const useStore = create<AppState>()(immer((set) => ({
  // Project and Pipeline State
  selectedProject: null,
  pipelineState: null,
  pipelineStatus: "idle",
  connectionStatus: "disconnected",
  messages: [],
  isHydrated: false,
  isLoading: false,
  error: null,

  // UI State
  selectedSceneId: null,
  currentPlaybackTime: 0,
  isPlaying: false,
  isDark: false,
  activeTab: "scenes",

  // Actions
  setSelectedProject: (projectId) => set({ selectedProject: projectId, pipelineState: null, isHydrated: false, isLoading: false, error: null, pipelineStatus: 'idle', messages: [] }),
  setPipelineState: (state) => set({ pipelineState: state }),
  setPipelineStatus: (status) => set({ pipelineStatus: status }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setIsHydrated: (hydrated) => set({ isHydrated: hydrated }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error: error }),
  addMessage: (message) => set((state) => { state.messages.unshift(message); }),
  clearMessages: () => set({ messages: [] }),
  removeMessage: (id) => set((state) => { state.messages = state.messages.filter(m => m.id !== id); }),

  updateScene: (sceneId, updates) => set((state) => {
    if (state.pipelineState?.storyboardState?.scenes) {
      const sceneIndex = state.pipelineState.storyboardState.scenes.findIndex((s: Scene) => s.id === sceneId);
      if (sceneIndex !== -1) {
        Object.assign(state.pipelineState.storyboardState.scenes[ sceneIndex ], updates);
      }
    }
  }),

  setSelectedSceneId: (id) => set({ selectedSceneId: id }),
  setCurrentPlaybackTime: (time) => set({ currentPlaybackTime: time }),
  setIsPlaying: (isPlaying) => set({ isPlaying: isPlaying }),
  setIsDark: (isDark) => set({ isDark: isDark }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  resetDashboard: () => set({
    pipelineStatus: "idle",
    selectedSceneId: null,
    currentPlaybackTime: 0,
  }),
})));
