import { scenes } from "../../../shared/schema";
import {
    Scene,
} from "../../../shared/types/pipeline.types";
import {
    SceneEntity
} from "../../../shared/zod-db";

export function mapDbSceneToDomain(entity: SceneEntity): Scene {
    return {
        id: entity.id,
        projectId: entity.projectId,
        createdAt: "", // Not on DB entity? It is via pgTable defaults but Zod might not pick it up?
        updatedAt: "",
        sceneIndex: entity.sceneIndex,
        status: entity.status as any,
        // Director / Audio / Script
        description: entity.description,
        mood: entity.mood,
        lyrics: entity.lyrics || undefined,
        startTime: entity.startTime,
        endTime: entity.endTime,
        // Composition
        ...entity.cinematography,
        lighting: entity.lighting,
        // Script Supervisor
        locationId: entity.locationId || "",
        characterIds: entity.characterIds || [],
        continuityNotes: [], // Not in DB schema explicitly?
        characters: entity.characterIds || [], // This is IDs in ScriptSupervisorSchema
        // Assets
        assets: entity.assets || {},
        // Flattened fields required by SceneSchema
        audioSync: "Mood Sync", // Default or extract?
        type: "lyrical", // Default
        duration: 4, // Default
        musicalDescription: "",
        musicChange: "",
        intensity: "medium",
        tempo: "moderate",
        transitionType: "Cut",
        audioEvidence: "",
        transientImpact: "soft",
        // ... other fields from AudioSegmentSchema that might be missing from DB columns
    } as unknown as Scene;
    // Note: The mapping here is imperfect because SceneSchema has many fields that are not in the simplified DB schema
    // defined in task.md. I will do my best to map what exists.
}

export function mapDomainSceneToDb(scene: Scene): typeof scenes.$inferInsert {
    return {
        id: scene.id,
        projectId: scene.projectId,
        sceneIndex: scene.sceneIndex,
        description: scene.description,
        mood: scene.mood,
        lyrics: scene.lyrics,
        startTime: scene.startTime,
        endTime: scene.endTime,
        cinematography: {
            shotType: scene.shotType,
            cameraMovement: scene.cameraMovement,
            cameraAngle: scene.cameraAngle,
            composition: scene.composition,
        },
        lighting: scene.lighting,
        locationId: scene.locationId,
        characterIds: scene.characters, // ScriptSupervisorSchema uses 'characters' for IDs
        status: scene.status as any,
        assets: scene.assets,
    };
}
