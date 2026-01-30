import * as schema from "./schema.js";
import { defineRelations } from "drizzle-orm";

export const relations = defineRelations(schema, (r) => ({
    scenes: {
        characters: r.many.characters({
            from: r.scenes.id.through(r.scenesToCharacters.sceneId),
            to: r.characters.id.through(r.scenesToCharacters.characterId),
        }),
        location: r.one.locations({
            from: r.scenes.locationId,
            to: r.locations.id,
        })
    },
    characters: {
        scenes: r.many.scenes()
    },
    locations: {
        scenes: r.many.scenes()
    }
}));