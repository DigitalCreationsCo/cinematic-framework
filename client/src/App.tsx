import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import { ProjectSelectionModal } from "@/components/ProjectSelectionModal";
import { InterventionModal } from "@/components/InterventionModal";
import { useStore } from "./lib/store";
import { useEffect, useState } from "react";
import { useProjects } from "./hooks/use-swr-api";

function Router() {
  return (
    <Switch>
      <Route path="/" component={ Dashboard } />
      <Route component={ NotFound } />
    </Switch>
  );
}

function App() {
  const { selectedProject, setSelectedProject } = useStore();
  const [ modalOpen, setModalOpen ] = useState(false);
  const [ projectToLoad, setProjectToLoad ] = useState<string | undefined>(undefined);

  const { data, isLoading, isError } = useProjects();

  useEffect(() => {
    if (!isLoading && !isError && data?.projects && data.projects.length > 0 && !selectedProject) {
      setModalOpen(true);
    }
  }, [ data, isLoading, isError, selectedProject ]);

  const handleConfirmProject = (projectId?: string) => {
    const id = typeof projectId === 'string' ? projectId : projectToLoad;
    if (id) {
      setSelectedProject(id);
      setModalOpen(false);
    }
  };

  return (
    <QueryClientProvider client={ queryClient }>
      <TooltipProvider>
        <Toaster />
        <InterventionModal />
        { selectedProject ? (
          <Router />
        ) : (
          <ProjectSelectionModal
            isOpen={ modalOpen }
            projects={ data?.projects || [] }
            selectedProject={ projectToLoad }
            onSelectProject={ setProjectToLoad }
            onConfirm={ handleConfirmProject }
          />
        ) }
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;