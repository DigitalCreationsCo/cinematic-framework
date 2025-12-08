import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { 
  ResizableHandle, 
  ResizablePanel, 
  ResizablePanelGroup 
} from "@/components/ui/resizable";
import { 
  Film, 
  Users, 
  MapPin, 
  BarChart3, 
  MessageSquare,
  ChevronLeft,
  Settings,
  Zap,
  Clock,
  RefreshCw,
  CheckCircle
} from "lucide-react";
import type { 
  Scene, 
  Character, 
  Location, 
  SceneStatus, 
  PipelineStatus,
  PipelineMessage,
  WorkflowMetrics
} from "@shared/pipeline-types";
import PipelineHeader from "@/components/PipelineHeader";
import SceneCard from "@/components/SceneCard";
import SceneDetailPanel from "@/components/SceneDetailPanel";
import Timeline from "@/components/Timeline";
import MessageLog from "@/components/MessageLog";
import CharacterCard from "@/components/CharacterCard";
import LocationCard from "@/components/LocationCard";
import MetricCard from "@/components/MetricCard";

// todo: remove mock functionality
const mockScenes: Scene[] = [
  { id: 1, startTime: 0, endTime: 6, duration: 6, type: "lyrical", lyrics: "Rising from the ashes of yesterday", description: "Epic opening", musicChange: "Build from silence", intensity: "high", mood: "Triumphant hero emerges from darkness into light", tempo: "moderate", transitionType: "Fade", shotType: "Wide Shot", cameraMovement: "Crane Up", lighting: "Dramatic backlight", audioSync: "Beat Sync", continuityNotes: ["Match color grade"], characters: ["char_1"], locationId: "loc_1", enhancedPrompt: "Cinematic wide shot...", evaluation: { overall: "ACCEPT", scores: { narrativeFidelity: { rating: "PASS", weight: 0.25, details: "Excellent" }, characterConsistency: { rating: "PASS", weight: 0.2, details: "Good" }, technicalQuality: { rating: "MINOR_ISSUES", weight: 0.2, details: "Minor grain" }, emotionalAuthenticity: { rating: "PASS", weight: 0.2, details: "Strong" }, continuity: { rating: "PASS", weight: 0.15, details: "Seamless" } }, issues: [], feedback: "Scene meets quality standards" } },
  { id: 2, startTime: 6, endTime: 12, duration: 6, type: "instrumental", lyrics: "", description: "Action sequence", musicChange: "", intensity: "high", mood: "Intense battle preparation", tempo: "fast", transitionType: "Cut", shotType: "Close-up", cameraMovement: "Dolly In", lighting: "Hard side light", audioSync: "Beat Sync", continuityNotes: [], characters: ["char_1", "char_2"], locationId: "loc_1" },
  { id: 3, startTime: 12, endTime: 20, duration: 8, type: "climax", lyrics: "We will rise together", description: "Climactic moment", musicChange: "Full orchestra", intensity: "extreme", mood: "Epic victory moment", tempo: "very_fast", transitionType: "Smash Cut", shotType: "Wide Shot", cameraMovement: "Crane Up", lighting: "Golden hour backlit", audioSync: "Lip Sync", continuityNotes: ["Peak emotional moment"], characters: ["char_1", "char_2"], locationId: "loc_2" },
  { id: 4, startTime: 20, endTime: 26, duration: 6, type: "lyrical", lyrics: "A new dawn awaits", description: "Resolution", musicChange: "Softer", intensity: "medium", mood: "Hopeful and peaceful", tempo: "moderate", transitionType: "Dissolve", shotType: "Medium Shot", cameraMovement: "Static", lighting: "Soft diffused", audioSync: "Lip Sync", continuityNotes: [], characters: ["char_1"], locationId: "loc_2" },
  { id: 5, startTime: 26, endTime: 30, duration: 4, type: "transition", lyrics: "", description: "Bridge", musicChange: "", intensity: "low", mood: "Reflective pause", tempo: "slow", transitionType: "Fade", shotType: "Wide Shot", cameraMovement: "Pan Right", lighting: "Natural", audioSync: "Mood Sync", continuityNotes: [], characters: [], locationId: "loc_3" },
  { id: 6, startTime: 30, endTime: 38, duration: 8, type: "instrumental", lyrics: "", description: "Solo section", musicChange: "Guitar solo", intensity: "high", mood: "Triumphant guitar solo", tempo: "fast", transitionType: "Cut", shotType: "Close-up", cameraMovement: "Handheld", lighting: "Concert lighting", audioSync: "Beat Sync", continuityNotes: [], characters: ["char_1"], locationId: "loc_3" },
];

const mockCharacters: Character[] = [
  { id: "char_1", name: "Elena Vance", aliases: ["The Shadow"], description: "Battle-hardened warrior with piercing blue eyes and a scar across her left cheek", physicalTraits: { hair: "Silver-white, braided", clothing: "Dark leather armor with blue accents", accessories: ["Ancient medallion", "Twin daggers"], distinctiveFeatures: ["Scar on left cheek", "Blue eyes", "Athletic build"] }, appearanceNotes: ["Always wears medallion"], state: { lastSeen: 6, emotionalState: "Determined" } },
  { id: "char_2", name: "Marcus Stone", aliases: [], description: "Elena's mentor, older warrior with graying beard and wise eyes", physicalTraits: { hair: "Gray, short cropped", clothing: "Worn leather tunic, fur cloak", accessories: ["Wooden staff", "Leather satchel"], distinctiveFeatures: ["Deep voice", "Weathered face"] }, appearanceNotes: [], state: { lastSeen: 3 } },
];

const mockLocations: Location[] = [
  { id: "loc_1", name: "Ancient Forest Temple", description: "Crumbling stone temple overgrown with vines, shafts of light piercing through", lightingConditions: "Dappled sunlight", timeOfDay: "Late afternoon", state: { lastUsed: 2 } },
  { id: "loc_2", name: "Mountain Summit", description: "Rocky peak above the clouds, wind-swept and majestic", lightingConditions: "Bright sunlight", timeOfDay: "Golden hour", state: { lastUsed: 4 } },
  { id: "loc_3", name: "Village Square", description: "Cobblestone square with market stalls and a central fountain", lightingConditions: "Warm evening light", timeOfDay: "Sunset", state: { lastUsed: 6 } },
];

const mockMessages: PipelineMessage[] = [
  { id: "1", type: "info", message: "Pipeline initialized - analyzing 6 scenes", timestamp: new Date(Date.now() - 120000) },
  { id: "2", type: "success", message: "Scene 1 generation complete (2 attempts)", timestamp: new Date(Date.now() - 90000), sceneId: 1 },
  { id: "3", type: "success", message: "Scene 2 generation complete (1 attempt)", timestamp: new Date(Date.now() - 60000), sceneId: 2 },
  { id: "4", type: "warning", message: "Scene 3 required 4 attempts - character consistency issues", timestamp: new Date(Date.now() - 30000), sceneId: 3 },
  { id: "5", type: "info", message: "Generating scene 4...", timestamp: new Date(), sceneId: 4 },
];

const mockSceneStatuses: Record<number, SceneStatus> = {
  1: "complete",
  2: "complete",
  3: "complete",
  4: "generating",
  5: "pending",
  6: "pending",
};

export default function Dashboard() {
  const [isDark, setIsDark] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>("generating");
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(1);
  const [messages, setMessages] = useState<PipelineMessage[]>(mockMessages);
  const [activeTab, setActiveTab] = useState("scenes");
  const [wsConnected, setWsConnected] = useState(true);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  const selectedScene = mockScenes.find(s => s.id === selectedSceneId);
  const selectedSceneCharacters = selectedScene 
    ? mockCharacters.filter(c => selectedScene.characters.includes(c.id))
    : [];
  const selectedSceneLocation = selectedScene
    ? mockLocations.find(l => l.id === selectedScene.locationId)
    : undefined;

  const completedScenes = Object.values(mockSceneStatuses).filter(s => s === "complete").length;

  const dismissMessage = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  // todo: remove mock functionality
  const metrics: WorkflowMetrics = {
    sceneMetrics: [
      { sceneId: 1, attempts: 2, bestAttempt: 2, finalScore: 92, duration: 45, ruleAdded: false },
      { sceneId: 2, attempts: 1, bestAttempt: 1, finalScore: 88, duration: 38, ruleAdded: false },
      { sceneId: 3, attempts: 4, bestAttempt: 4, finalScore: 85, duration: 120, ruleAdded: true },
    ],
    globalTrend: {
      averageAttempts: 2.3,
      attemptTrendSlope: -0.15,
      qualityTrendSlope: 0.05,
    },
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <PipelineHeader
        title="Epic Fantasy Music Video"
        status={pipelineStatus}
        connected={wsConnected}
        progress={{ current: completedScenes, total: mockScenes.length }}
        isDark={isDark}
        onToggleTheme={() => setIsDark(!isDark)}
        onStart={() => setPipelineStatus("generating")}
        onPause={() => setPipelineStatus("idle")}
        onReset={() => {
          setPipelineStatus("idle");
          setSelectedSceneId(null);
        }}
      />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={65} minSize={40}>
            <div className="h-full flex flex-col">
              <div className="p-4 pb-2 border-b shrink-0">
                <Timeline
                  scenes={mockScenes}
                  sceneStatuses={mockSceneStatuses}
                  selectedSceneId={selectedSceneId ?? undefined}
                  totalDuration={38}
                  onSceneSelect={setSelectedSceneId}
                />
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 pt-3 shrink-0">
                  <TabsList>
                    <TabsTrigger value="scenes" data-testid="tab-scenes">
                      <Film className="w-4 h-4 mr-1.5" />
                      Scenes
                    </TabsTrigger>
                    <TabsTrigger value="characters" data-testid="tab-characters">
                      <Users className="w-4 h-4 mr-1.5" />
                      Characters
                    </TabsTrigger>
                    <TabsTrigger value="locations" data-testid="tab-locations">
                      <MapPin className="w-4 h-4 mr-1.5" />
                      Locations
                    </TabsTrigger>
                    <TabsTrigger value="metrics" data-testid="tab-metrics">
                      <BarChart3 className="w-4 h-4 mr-1.5" />
                      Metrics
                    </TabsTrigger>
                    <TabsTrigger value="logs" data-testid="tab-logs">
                      <MessageSquare className="w-4 h-4 mr-1.5" />
                      Logs
                      {messages.length > 0 && (
                        <span className="ml-1.5 text-[10px] bg-primary text-primary-foreground rounded-full px-1.5">
                          {messages.length}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="scenes" className="flex-1 overflow-hidden mt-0 p-4">
                  <ScrollArea className="h-full">
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pb-4">
                      {mockScenes.map((scene) => (
                        <SceneCard
                          key={scene.id}
                          scene={scene}
                          status={mockSceneStatuses[scene.id] || "pending"}
                          isSelected={scene.id === selectedSceneId}
                          onSelect={() => setSelectedSceneId(scene.id)}
                          onPlay={() => console.log("Play scene", scene.id)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="characters" className="flex-1 overflow-hidden mt-0 p-4">
                  <ScrollArea className="h-full">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
                      {mockCharacters.map((char) => (
                        <CharacterCard
                          key={char.id}
                          character={char}
                          onSelect={() => console.log("Select character", char.id)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="locations" className="flex-1 overflow-hidden mt-0 p-4">
                  <ScrollArea className="h-full">
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pb-4">
                      {mockLocations.map((loc) => (
                        <LocationCard
                          key={loc.id}
                          location={loc}
                          onSelect={() => console.log("Select location", loc.id)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="metrics" className="flex-1 overflow-hidden mt-0 p-4">
                  <ScrollArea className="h-full">
                    <div className="space-y-4 pb-4">
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <MetricCard
                          label="Avg Attempts"
                          value={metrics.globalTrend?.averageAttempts.toFixed(1) || "—"}
                          subValue="per scene"
                          trend={metrics.globalTrend && metrics.globalTrend.attemptTrendSlope < 0 ? "down" : "neutral"}
                          trendValue={metrics.globalTrend ? `${(metrics.globalTrend.attemptTrendSlope * 100).toFixed(0)}% trend` : undefined}
                          icon={<RefreshCw className="w-5 h-5" />}
                        />
                        <MetricCard
                          label="Quality Score"
                          value={`${Math.round(metrics.sceneMetrics.reduce((a, m) => a + m.finalScore, 0) / metrics.sceneMetrics.length)}%`}
                          trend={metrics.globalTrend && metrics.globalTrend.qualityTrendSlope > 0 ? "up" : "neutral"}
                          trendValue={metrics.globalTrend ? `+${(metrics.globalTrend.qualityTrendSlope * 100).toFixed(0)}% improvement` : undefined}
                          icon={<CheckCircle className="w-5 h-5" />}
                        />
                        <MetricCard
                          label="Avg Duration"
                          value={`${(metrics.sceneMetrics.reduce((a, m) => a + m.duration, 0) / metrics.sceneMetrics.length / 60).toFixed(1)}m`}
                          subValue="per scene"
                          icon={<Clock className="w-5 h-5" />}
                        />
                        <MetricCard
                          label="Rules Added"
                          value={metrics.sceneMetrics.filter(m => m.ruleAdded).length}
                          subValue="this session"
                          icon={<Zap className="w-5 h-5" />}
                        />
                      </div>

                      <Card>
                        <CardHeader className="p-4 pb-2">
                          <CardTitle className="text-sm font-semibold">Scene Generation History</CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                          <div className="space-y-2">
                            {metrics.sceneMetrics.map((m) => (
                              <div 
                                key={m.sceneId} 
                                className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-mono">#{m.sceneId}</span>
                                  <span className="text-sm text-muted-foreground">
                                    {m.attempts} attempt{m.attempts !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-medium">{m.finalScore}%</span>
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {(m.duration / 60).toFixed(1)}m
                                  </span>
                                  {m.ruleAdded && (
                                    <Zap className="w-3.5 h-3.5 text-chart-4" />
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="logs" className="flex-1 overflow-hidden mt-0 p-4">
                  <Card className="h-full">
                    <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold">Pipeline Messages</CardTitle>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => setMessages([])}
                        data-testid="button-clear-logs"
                      >
                        Clear
                      </Button>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <MessageLog 
                        messages={messages}
                        maxHeight="calc(100vh - 20rem)"
                        onDismiss={dismissMessage}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={35} minSize={25}>
            {selectedScene ? (
              <SceneDetailPanel
                scene={selectedScene}
                status={mockSceneStatuses[selectedScene.id] || "pending"}
                characters={selectedSceneCharacters}
                location={selectedSceneLocation}
                onRegenerate={() => console.log("Regenerate scene", selectedScene.id)}
                onPlayVideo={() => console.log("Play video", selectedScene.id)}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                <Film className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm text-center">Select a scene to view details</p>
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
