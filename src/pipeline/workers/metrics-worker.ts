import { db } from "../../shared/db";
import { projects, scenes } from "../../shared/schema";
import { eq, asc } from "drizzle-orm";
import { predictRemainingAttempts, calculateTrend } from "../../shared/utils/regression";
import { WorkflowMetrics } from "../../shared/types/pipeline.types";

export async function aggregateProjectPerformance(projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId)
  });

  if (!project) return;

  const projectScenes = await db.query.scenes.findMany({
    where: eq(scenes.projectId, projectId),
    orderBy: [asc(scenes.sceneIndex)]
  });

  const attemptHistory: number[] = [];
  const qualityScores: number[] = [];
  let totalDuration = 0;

  for (const s of projectScenes) {
    // Only count completed scenes for trends
    if (s.status === 'complete') {
        const videoAssets = s.assets?.['scene_video'];
        if (videoAssets) {
            attemptHistory.push(videoAssets.head || 1); // 'head' version implies number of attempts
            
            // Find best version score
            const bestVer = videoAssets.versions.find(v => v.version === videoAssets.best);
            const score = bestVer?.metadata?.evaluation?.scores?.narrativeFidelity?.weight || 0; 
            // Simplified score extraction - ideally we average or take overall score
            qualityScores.push(score);
        }
    }
    totalDuration += (s.endTime - s.startTime);
  }

  const totalScenes = projectScenes.length;
  const completedCount = attemptHistory.length;
  const remainingScenes = Math.max(0, totalScenes - completedCount);
  
  const predictedAttempts = predictRemainingAttempts(attemptHistory, remainingScenes);
  const trend = calculateTrend(qualityScores);

  const avgAttempts = attemptHistory.length > 0 
    ? attemptHistory.reduce((a,b)=>a+b,0) / attemptHistory.length 
    : 0;

  const metrics: WorkflowMetrics = {
    totalScenes,
    completedScenes: Completed\nCount,
    averageAttemptsPerScene: avgAttempts,
    estimatedRemainingAttempts: predictedAttempts,
    qualityTrendSlope: trend.slope,
    totalDuration,
    // Add other fields from WorkflowMetricsSchema if needed
  };

  await db.update(projects)
    .set({ metrics, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}
