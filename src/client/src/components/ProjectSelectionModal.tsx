import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uploadAudio, startPipeline } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { useStore } from '@/lib/store';
import { Project } from '@shared/types/pipeline.types';

interface ProjectSelectionModalProps {
  isOpen: boolean;
  projects: any[];
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

  const { setProjectStatus, setProject } = useStore();

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

      // Optimistic update to show "Analyzing" state immediately
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Select or Create Project</DialogTitle>
          <DialogDescription>
            Resume an existing project or start a new cinematic video generation.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="resume" value={ mode } onValueChange={ (v) => setMode(v as any) } className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="resume">Resume Existing</TabsTrigger>
            <TabsTrigger value="create">Start New</TabsTrigger>
          </TabsList>

          <TabsContent value="resume" className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>Select Project</Label>
              <Select onValueChange={ onSelectProject } value={ selectedProject }>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  { projects.map((project) => (
                    <SelectItem key={ project } value={ project.id }>
                      { project.name }
                    </SelectItem>
                  )) }
                </SelectContent>
              </Select>
            </div>
            <Button onClick={ () => onConfirm() } disabled={ !selectedProject } className="w-full">
              Load Project
            </Button>
          </TabsContent>

          <TabsContent value="create" className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="projectId">Project Name (optional)</Label>
              <Input
                id="title"
                value={ title }
                onChange={ (e) => setTitle(e.target.value) }
                placeholder="This Is Your Moment"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="prompt">Creative Prompt</Label>
              <Textarea
                id="prompt"
                value={ enhancedPrompt }
                onChange={ (e) => setCreativePrompt(e.target.value) }
                placeholder="Describe the cinematic video you want to generate..."
                className="h-24"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="audio">Audio Track</Label>
              <Input
                id="audio"
                type="file"
                accept="audio/*"
                onChange={ (e) => setAudioFile(e.target.files?.[ 0 ] || null) }
              />
            </div>

            { error && <div className="text-sm text-red-500">{ error }</div> }

            <Button onClick={ handleCreateProject } disabled={ isCreating } className="w-full">
              { isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create & Start Project"
              ) }
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
