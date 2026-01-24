import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Button } from "#/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { Card, CardContent } from "#/components/ui/card";
import { uploadAudio, startPipeline } from "#/lib/api";
import { Loader2, Moon, Sun, Sparkles, FolderOpen, Plus } from "lucide-react";
import { useStore } from '#/lib/store';
import { Project } from '#shared/types/workflow.types';

interface ProjectSelectionModalProps {
  isOpen: boolean;
  projects: Pick<Project, "id" | "metadata">[];
  selectedProject: string | undefined;
  onSelectProject: (project: string) => void;
  onConfirm: (projectId?: string) => void;
}

export const ProjectSelectionModal: React.FC<ProjectSelectionModalProps> = ({
  isOpen,
  projects,
  selectedProject,
  onSelectProject,
  onConfirm,
}) => {

  const { setProjectStatus, setProject, isDark } = useStore();

  const [ mode, setMode ] = useState<"resume" | "create">("resume");
  const [ title, setTitle ] = useState("");
  const [ enhancedPrompt, setCreativePrompt ] = useState("");
  const [ audioFile, setAudioFile ] = useState<File | null>(null);
  const [ isCreating, setIsCreating ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const handleCreateProject = async () => {
    if (!enhancedPrompt) {
      setError("Please fill in creative prompt.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      let audioGcsUri: string | undefined;
      let audioPublicUri: string | undefined;
      if (audioFile) {
        audioGcsUri = (await uploadAudio(audioFile)).audioGcsUri;
        audioPublicUri = (await uploadAudio(audioFile)).audioPublicUri;
      }

      const result = await startPipeline({
        payload: {
          title: title,
          initialPrompt: enhancedPrompt,
          audioGcsUri,
          audioPublicUri
        },
      });

      setProject({
        currentSceneIndex: 0,
        generationRules: [],
        scenes: [],
        characters: [],
        locations: [],
        storyboard: {
          scenes: [],
          characters: [],
          locations: [],
          metadata: {
            hasAudio: !!audioGcsUri,
            audioPublicUri: audioPublicUri,
            enhancedPrompt: enhancedPrompt,
            audioGcsUri,
            title: "Creating project..."
          },
        }
      } as unknown as Project);
      setProjectStatus("analyzing");

      onSelectProject(result.projectId);
      onConfirm(result.projectId);
    } catch (err: any) {
      console.error("Failed to create project:", err);
      setError(err.message || "Failed to create project.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={ isOpen }>
      <DialogContent className="sm:max-w-[500px] p-0 flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="p-4 border-b flex flex-row items-center justify-between gap-4 shrink-0 space-y-0">
          <div className="flex flex-col gap-1 min-w-0">
            <DialogTitle className="text-lg font-semibold truncate">Select or Create Project</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground truncate">
              Resume an existing project or start a new cinematic video generation.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="resume" value={ mode } onValueChange={ (v) => setMode(v as any) } className="w-full flex flex-col">
            <div className="px-4 pt-3 shrink-0">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="resume" data-testid="tab-resume">
                  <FolderOpen className="w-4 h-4 mr-1.5" />
                  Resume Existing
                </TabsTrigger>
                <TabsTrigger value="create" data-testid="tab-create">
                  <Plus className="w-4 h-4 mr-1.5" />
                  Start New
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="resume" className="flex-1 p-4 mt-0">
              <Card className="border-none shadow-none bg-transparent">
                <CardContent className="p-0 space-y-4">
                  <div className="grid gap-2">
                    <Label className="text-sm font-medium">Select Project</Label>
                    <Select onValueChange={ onSelectProject } value={ selectedProject }>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                      <SelectContent>
                        { projects.length > 0 ? projects.map((project) => (
                          <SelectItem key={ project.id } value={ project.id }>
                            { project.metadata.title || "Untitled Project" }
                            <span className="ml-2 text-[10px] text-muted-foreground font-mono opacity-50">#{ project.id.slice(0, 8) }</span>
                          </SelectItem>
                        )) : (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            No projects found.
                          </div>
                        ) }
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={ () => onConfirm() }
                    disabled={ !selectedProject }
                    className="w-full"
                  >
                    Load Project
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="create" className="flex-1 p-4 mt-0">
              <Card className="border-none shadow-none bg-transparent">
                <CardContent className="p-0 space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="title" className="text-sm font-medium">Project Name (optional)</Label>
                    <Input
                      id="title"
                      value={ title }
                      onChange={ (e) => setTitle(e.target.value) }
                      placeholder="e.g., This Is My Moment"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="prompt" className="text-sm font-medium">Creative Prompt</Label>
                    <Textarea
                      id="prompt"
                      value={ enhancedPrompt }
                      onChange={ (e) => setCreativePrompt(e.target.value) }
                      placeholder="Describe the cinematic video you want to generate..."
                      className="h-24"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="audio" className="text-sm font-medium">
                      Audio (optional)
                    </Label>
                    <Input
                      id="audio"
                      type="file"
                      accept="audio/*"
                      onChange={ (e) => setAudioFile(e.target.files?.[ 0 ] || null) }
                      className="cursor-pointer"
                    />
                  </div>

                  { error && <div className="text-sm text-destructive bg-destructive/10 p-2 rounded-md border border-destructive/20">{ error }</div> }

                  <Button
                    onClick={ handleCreateProject }
                    disabled={ isCreating }
                    className="w-full"
                  >
                    { isCreating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Create & Start Project
                      </>
                    ) }
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};
