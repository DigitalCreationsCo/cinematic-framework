import { create } from 'zustand';
import { GraphState, Scene, PipelineStatus, PipelineMessage, InitialGraphState } from '@shared/pipeline-types';
import { immer } from 'zustand/middleware/immer';

type ConnectionStatus = "connected" | "disconnected" | "connecting";

interface AppState {
  // Project and Pipeline State
  selectedProject: string | null;
  connectionStatus: ConnectionStatus;
  isHydrated: boolean;

  pipelineState: GraphState | InitialGraphState | null;
  pipelineStatus: PipelineStatus;
  isLoading: boolean;
  error: string | null;

  interruptionState: {
    error: string;
    functionName?: string;
    currentParams: any;
  } | null;
  messages: PipelineMessage[];

  // UI State
  selectedSceneId: number | null;
  currentPlaybackTime: number;
  isPlaying: boolean;
  activeTab: string;
  isDark: boolean;


  // Actions
  setSelectedProject: (projectId: string | null) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setIsHydrated: (hydrated: boolean) => void;

  setPipelineState: (state: GraphState | InitialGraphState | null) => void;
  setPipelineStatus: (status: PipelineStatus) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  setInterruptionState: (state: AppState[ 'interruptionState' ]) => void;
  addMessage: (message: PipelineMessage) => void;
  clearMessages: () => void;
  removeMessage: (id: string) => void;

  updateScene: (sceneId: number, updates: Partial<Scene> | ((state: Scene) => Partial<Scene>)) => void;
  setSelectedSceneId: (id: number | null) => void;
  setCurrentPlaybackTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setActiveTab: (tab: string) => void;
  setIsDark: (isDark: boolean) => void;
  resetDashboard: () => void;
}

export const useStore = create<AppState>()(immer((set) => ({
  // Project and Pipeline State
  selectedProject: null,
  pipelineState: null,
  pipelineStatus: "ready",
  connectionStatus: "disconnected",
  messages: [],
  isHydrated: false,
  isLoading: false,
  error: null,
  interruptionState: null,

  // UI State
  selectedSceneId: null,
  currentPlaybackTime: 0,
  isPlaying: false,
  isDark: false,
  activeTab: "scenes",

  // Actions
  setSelectedProject: (projectId) => set({ selectedProject: projectId, pipelineState: null, isHydrated: false, isLoading: false, error: null, pipelineStatus: 'ready', messages: [] }),
  setPipelineState: (state) => set({ pipelineState: state }),
  setPipelineStatus: (status) => set({ pipelineStatus: status }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setIsHydrated: (hydrated) => set({ isHydrated: hydrated }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error: error }),
  setInterruptionState: (state) => set({ interruptionState: state }),
  addMessage: (message) => set((state) => { state.messages.unshift(message); }),
  clearMessages: () => set({ messages: [] }),
  removeMessage: (id) => set((state) => { state.messages = state.messages.filter(m => m.id !== id); }),

  updateScene: (sceneId, updates) => set((state) => {
    if (state.pipelineState?.storyboardState?.scenes) {
      const sceneIndex = state.pipelineState.storyboardState.scenes.findIndex((s: Scene) => s.id === sceneId);
      if (sceneIndex !== -1) {
        const scene = state.pipelineState.storyboardState.scenes[ sceneIndex ];
        const newValues = typeof updates === 'function' ? updates(scene) : updates;
        Object.assign(scene, newValues);
      }
    }
  }),

  setSelectedSceneId: (id) => set({ selectedSceneId: id }),
  setCurrentPlaybackTime: (time) => set({ currentPlaybackTime: time }),
  setIsPlaying: (isPlaying) => set({ isPlaying: isPlaying }),
  setIsDark: (isDark) => set({ isDark: isDark }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  resetDashboard: () => set({
    pipelineStatus: "ready",
    selectedSceneId: null,
    currentPlaybackTime: 0,
  }),
})));
