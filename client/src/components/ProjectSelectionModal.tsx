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

interface ProjectSelectionModalProps {
  isOpen: boolean;
  projects: string[];
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
  const [ mode, setMode ] = useState<"resume" | "create">("resume");
  const [ newProjectId, setNewProjectId ] = useState("");
  const [ creativePrompt, setCreativePrompt ] = useState("");
  const [ audioFile, setAudioFile ] = useState<File | null>(null);
  const [ isCreating, setIsCreating ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const handleCreateProject = async () => {
    if (!creativePrompt || !audioFile) {
      setError("Please fill in creative prompt and select an audio file.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // 1. Upload Audio
      const { gsUri } = await uploadAudio(audioFile);

      // 2. Start Pipeline
      const result = await startPipeline({
        projectId: newProjectId || undefined,
        creativePrompt: creativePrompt,
        audioUrl: gsUri,
      });

      // 3. Select and Confirm
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
                    <SelectItem key={ project } value={ project }>
                      { project }
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
              <Label htmlFor="projectId">Project Name (ID)</Label>
              <Input
                id="projectId"
                value={ newProjectId }
                onChange={ (e) => setNewProjectId(e.target.value) }
                placeholder="e.g. my-awesome-video"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="prompt">Creative Prompt</Label>
              <Textarea
                id="prompt"
                value={ creativePrompt }
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
