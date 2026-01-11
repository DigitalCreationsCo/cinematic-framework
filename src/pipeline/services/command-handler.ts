import { db } from "../../shared/db";
import { projects, scenes, jobs } from "../../shared/schema";
import { 
  RegenerateSceneCommand, 
  UpdateSceneAssetCommand 
} from "../../shared/types/pubsub.types";
import { eq, sql } from "drizzle-orm";

export const PipelineCommandHandler = {
  /**
   * UPDATE_SCENE_ASSET: Manually promotes a specific version 
   * or rejects a generation.
   */
  async handleUpdateAsset(cmd: UpdateSceneAssetCommand) {
    const { scene, assetKey, version } = cmd.payload;

    return await db.transaction(async (tx) => {
      // 1. Fetch current assets
      const existing = await tx.query.scenes.findFirst({
        where: eq(scenes.id, scene.id),
        columns: { assets: true }
      });

      if (!existing) throw new Error("Scene not found");

      const currentAssets = existing.assets || {};
      const history = currentAssets[assetKey];

      if (history) {
        // 2. Update the 'best' pointer or remove if version is null
        if (version === null) {
          // Logic for rejection/deletion
          history.best = 0; 
        } else {
          // Logic for promotion
          const exists = history.versions.some(v => v.version === version);
          if (exists) history.best = version;
        }
      }

      // 3. Persist back to DB
      await tx.update(scenes)
        .set({ 
          assets: currentAssets,
          updatedAt: new Date() 
        })
        .where(eq(scenes.id, scene.id));

      return { success: true, updatedAssets: currentAssets };
    });
  },

  /**
   * REGENERATE_SCENE: Flags a scene for the worker and creates a new Job.
   */
  async handleRegenerateScene(cmd: RegenerateSceneCommand) {
    const { sceneId, forceRegenerate, promptModification } = cmd.payload;

    return await db.transaction(async (tx) => {
      // 1. Update Project state to track which IDs need forced generation
      if (forceRegenerate) {
        // We need to fetch the project ID for the scene first, or use cmd.projectId if available
        // cmd has projectId.
        
        await tx.update(projects)
          .set({
            forceRegenerateSceneIds: sql`array_append(${projects.forceRegenerateSceneIds}, ${sceneId})`,
            status: "generating"
          })
          .where(eq(projects.id, cmd.projectId));
      }

      // 2. Create the Generative Job
      const [newJob] = await tx.insert(jobs).values({
        projectId: cmd.projectId,
        type: "GENERATE_SCENE_VIDEO",
        state: "CREATED",
        payload: {
          sceneId,
          modification: promptModification,
          attempt: 1 // Logic to increment attempt based on history could go here
        }
      }).returning();

      return newJob;
    });
  }
};
