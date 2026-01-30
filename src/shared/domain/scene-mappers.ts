import {
    Scene,
    SceneEntity,
    InsertScene
} from "../types/index.js";
import { z } from "zod";



export function mapDbSceneToDomain(entity: SceneEntity): Scene {
    const scene = Scene.parse(entity);
    return scene;
}

export function mapDomainSceneToInsertSceneDb(sceneAttributes: z.input<typeof InsertScene>): z.infer<typeof InsertScene> {
    const insertScene = InsertScene.parse(sceneAttributes);
    return insertScene;
}
