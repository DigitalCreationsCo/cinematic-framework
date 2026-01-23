import {
    Scene,
    SceneAttributes,
} from "../../../shared/types/workflow.types";
import {
    SceneEntity, InsertScene
} from "../../../shared/db/zod-db";

export function mapDbSceneToDomain(entity: SceneEntity): Scene {
    return Scene.parse(entity);
}

export function mapDomainSceneToDb(sceneAttributes: SceneAttributes) {
    return InsertScene.parse(sceneAttributes);
}
