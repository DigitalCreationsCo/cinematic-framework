import { db } from "../db/index.js";
import { scenes, projects, characters, locations } from "../db/schema.js";
import { eq, asc, inArray, sql, } from "drizzle-orm";
import {
    Scene, Location, Project, Character,
    SceneAttributes,
    CharacterAttributes,
    LocationAttributes,
} from "../types/workflow.types.js";
import {
    DbProjectSchema, DbSceneSchema, DbCharacterSchema, DbLocationSchema, ProjectEntity,
    SceneEntity,
    CharacterEntity,
    LocationEntity,
    InsertScene,
    InsertCharacter,
    InsertLocation,
    InsertProject,
} from "../db/zod-db.js";
import { mapDbProjectToDomain, mapDomainProjectToInsertProjectDb } from "../domain/project-mappers.js";
import { mapDbSceneToDomain, mapDomainSceneToInsertSceneDb } from "../domain/scene-mappers.js";
import { mapDbCharacterToDomain, mapDomainCharacterToInsertCharacterDb } from "../domain/character-mappers.js";
import { mapDbLocationToDomain, mapDomainLocationToInsertLocationDb } from "../domain/location-mappers.js";
import { getTableColumns } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';



export class ProjectRepository {

    async getProjects() {
        if (!db) throw new Error("Database not initialized");

        const records = await db.select({
            id: projects.id,
            metadata: { title: sql`${projects.metadata}->>'title'`.as('title'), }
        })
            .from(projects);
        return records;
    }

    async getProject(projectId: string, tx: any = db): Promise<ProjectEntity> {
        if (!tx) throw new Error("Database not initialized");

        const [ record ] = await tx.select().from(projects).where(eq(projects.id, projectId));
        if (!record) throw new Error(`Project ${projectId} not found`);

        return DbProjectSchema.parse(record);
    }

    async getProjectFullState(projectId: string, tx: any = db): Promise<Project> {
        if (!tx) throw new Error("Database not initialized");

        const projectEntity = await this.getProject(projectId, tx);
        console.debug({ storyboardNumScenes: projectEntity.storyboard.scenes.length });
        console.debug({ storyboardNumChars: projectEntity.storyboard.characters.length });
        console.debug({ storyboardNumLocs: projectEntity.storyboard.locations.length });

        const dbScenes = await tx.select().from(scenes)
            .where(eq(scenes.projectId, projectId))
            .orderBy(asc(scenes.sceneIndex)) as SceneEntity[];
        const dbChars = await tx.select().from(characters).where(eq(characters.projectId, projectId)) as CharacterEntity[];
        const dbLocs = await tx.select().from(locations).where(eq(locations.projectId, projectId)) as LocationEntity[];

        const domainScenes = dbScenes.map(s => mapDbSceneToDomain(DbSceneSchema.parse(s)));
        const domainCharacters = dbChars.map(c => mapDbCharacterToDomain(DbCharacterSchema.parse(c)));
        const domainLocations = dbLocs.map(l => mapDbLocationToDomain(DbLocationSchema.parse(l)));
        console.debug({ returnedNumScenes: domainScenes.length });
        console.debug({ returnedNumChars: domainCharacters.length });
        console.debug({ returnedNumLocs: domainLocations.length });

        return mapDbProjectToDomain({
            project: projectEntity,
            scenes: domainScenes,
            characters: domainCharacters,
            locations: domainLocations,
        });
    }

    async createProject(insert: Project): Promise<Project> {
        if (!db) throw new Error("Database not initialized");

        const projectId = insert.id || uuidv7();
        insert.id = projectId;

        let scenes = insert.scenes.map(s => InsertScene.parse({
            ...s,
            projectId,
            updatedAt: new Date()
        }));
        let characters = insert.characters.map(c => InsertCharacter.parse({
            ...c,
            projectId,
            updatedAt: new Date()
        }));
        let locations = insert.locations.map(l => InsertLocation.parse({
            ...l,
            projectId,
            updatedAt: new Date()
        }));

        if (insert.scenes && insert.scenes.length > 0) {
            scenes = await this.createScenes(insert.id, insert.scenes);
        }
        if (insert.characters && insert.characters.length > 0) {
            characters = await this.createCharacters(insert.id, insert.characters);
        }
        if (insert.locations && insert.locations.length > 0) {
            locations = await this.createLocations(insert.id, insert.locations);
        }

        const projectEntity = mapDomainProjectToInsertProjectDb(insert);
        projectEntity.storyboard = {
            metadata: projectEntity.metadata,
            scenes: scenes,
            characters: characters,
            locations: locations,
        };
        const [ project ] = await db.insert(projects).values(projectEntity as Project).returning();

        return mapDbProjectToDomain({ project });
    }

    /* 
    * Helper to dynamically build the 'set' clause for upserts
    * This tells Postgres: "If conflict, update these columns with the new values"
    * 
    */
    private buildConflictUpdateColumns(table: any) {
        const columns = getTableColumns(table);
        const updateSet: Record<string, any> = {};

        Object.entries(columns as Record<string, any>).forEach(([ drizzleName, columnObj ]) => {
            const dbName = columnObj.name;
            updateSet[ drizzleName ] = sql.raw(`excluded.${dbName}`);
        });

        return updateSet;
    };

    async updateProject(projectId: string, data: Partial<InsertProject>): Promise<Project> {
        if (!db) throw new Error("Database not initialized");

        return await db.transaction(async (tx) => {

            const {
                scenes: sceneDrafts,
                characters: charDrafts,
                locations: locDrafts,
                metadata,
                audioAnalysis,
                metrics,
                storyboard,
                ...projectFields
            } = data;

            let validScenes: any[] = [];
            let validChars: any[] = [];
            let validLocs: any[] = [];

            if (sceneDrafts && sceneDrafts.length > 0) {
                const scenesToUpsert = sceneDrafts.map(s => InsertScene.parse({
                    ...s,
                    projectId,
                    updatedAt: new Date()
                }));
                validScenes = await tx.insert(scenes)
                    .values(scenesToUpsert)
                    .onConflictDoUpdate({
                        target: scenes.id,
                        set: this.buildConflictUpdateColumns(scenes)
                    })
                    .returning();
                console.debug({ insertedNumScenes: validScenes.length });
            }

            if (charDrafts && charDrafts.length > 0) {
                const charsToUpsert = charDrafts.map(c => InsertCharacter.parse({
                    ...c,
                    projectId,
                    updatedAt: new Date()
                }));
                validChars = await tx.insert(characters)
                    .values(charsToUpsert)
                    .onConflictDoUpdate({ target: characters.id, set: this.buildConflictUpdateColumns(characters) })
                    .returning();
                console.debug({ insertedNumChars: validChars.length });
            }

            if (locDrafts && locDrafts.length > 0) {
                const locsToUpsert = locDrafts.map(l => InsertLocation.parse({
                    ...l,
                    projectId,
                    updatedAt: new Date()
                }));
                validLocs = await tx.insert(locations)
                    .values(locsToUpsert)
                    .onConflictDoUpdate({ target: locations.id, set: this.buildConflictUpdateColumns(locations) })
                    .returning();
                console.debug({ insertedNumLocs: validLocs.length });
            }

            let projectPayload: any = { ...projectFields, updatedAt: new Date() };

            if (storyboard) {
                const enrichedStoryboard = {
                    ...storyboard,
                    scenes: validScenes.map(mapDbSceneToDomain),
                    characters: validChars.map(mapDbCharacterToDomain),
                    locations: validLocs.map(mapDbLocationToDomain),
                };

                projectPayload.storyboard = enrichedStoryboard;
            }
            if (metadata) {
                projectPayload.metadata = sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb`;
            }
            if (metrics) {
                projectPayload.metrics = sql`COALESCE(metrics, '{}'::jsonb) || ${JSON.stringify(metrics)}::jsonb`;
            }
            if (audioAnalysis) {
                projectPayload.audioAnalysis = audioAnalysis;
            }

            if (Object.keys(projectPayload).length > 0) {
                await tx.update(projects)
                    .set(projectPayload)
                    .where(eq(projects.id, projectId));
            }

            return this.getProjectFullState(projectId, tx);
        });
    }

    async appendProjectForceRegenerateSceneIds(projectId: string, sceneIds: string[]): Promise<Project> {
        if (!db) throw new Error("Database not initialized");

        const updatePayload: any = { updatedAt: new Date() };
        updatePayload.forceRegenerateSceneIds =
            sql`array_cat(${projects.forceRegenerateSceneIds}, ${sceneIds})`;
        const [ update ] = await db.update(projects)
            .set(updatePayload)
            .where(eq(projects.id, projectId))
            .returning();

        return mapDbProjectToDomain({ project: update });
    }

    async updateCharacters(updates: Character[]) {
        if (!db) throw new Error("Database not initialized");

        return Promise.all(updates.map(async char => {
            const [ row ] = await db.update(characters)
                .set({ ...char, updatedAt: new Date() })
                .where(eq(characters.id, char.id))
                .returning();
            return row;
        }));
    };

    async updateLocations(updates: Location[]) {
        if (!db) throw new Error("Database not initialized");

        return Promise.all(updates.map(async loc => {
            const [ row ] = await db.update(locations)
                .set({ ...loc, updatedAt: new Date() })
                .where(eq(locations.id, loc.id))
                .returning();
            return row;
        }));
    };

    async getScene(sceneId: string): Promise<Scene> {
        if (!db) throw new Error("Database not initialized");

        const [ record ] = await db.select().from(scenes).where(eq(scenes.id, sceneId));
        if (!record) throw new Error(`Scene ${sceneId} not found`);
        return mapDbSceneToDomain(DbSceneSchema.parse(record));
    }

    async getProjectScenes(projectId: string): Promise<Scene[]> {
        if (!db) throw new Error("Database not initialized");

        const records = await db.select().from(scenes)
            .where(eq(scenes.projectId, projectId))
            .orderBy(asc(scenes.sceneIndex));
        return records.map(r => mapDbSceneToDomain(DbSceneSchema.parse(r)));
    }

    async createScenes(projectId: string, scenesData: SceneAttributes[]): Promise<Scene[]> {
        if (!db) throw new Error("Database not initialized");

        const rows = scenesData.map(s => ({
            ...mapDomainSceneToInsertSceneDb({ ...s, projectId }),
            projectId // Ensure project ID override
        }));
        if (rows.length === 0) return [];

        const upserted = await db
            .insert(scenes)
            .values(rows)
            .onConflictDoUpdate({
                target: scenes.id,
                set: { ...rows[ 0 ] }
            })
            .returning();
        return upserted.map(c => mapDbSceneToDomain(DbSceneSchema.parse(c)));
    }

    async createCharacters(projectId: string, charactersData: CharacterAttributes[]): Promise<Character[]> {
        if (!db) throw new Error("Database not initialized");

        const rows = charactersData.map(s => mapDomainCharacterToInsertCharacterDb({ ...s, projectId }));
        if (rows.length === 0) return [];

        const upserted = await db
            .insert(characters)
            .values(rows)
            .onConflictDoUpdate({
                target: characters.id,
                set: { ...rows[ 0 ] }
            })
            .returning();
        return upserted.map(c => mapDbCharacterToDomain(DbCharacterSchema.parse(c)));
    }
    async createLocations(projectId: string, locationsData: LocationAttributes[]): Promise<Location[]> {
        if (!db) throw new Error("Database not initialized");

        const rows = locationsData.map(s => ({
            ...mapDomainLocationToInsertLocationDb({ ...s, projectId }),
            projectId
        }));
        if (rows.length === 0) return [];

        const upserted = await db
            .insert(locations)
            .values(rows)
            .onConflictDoUpdate({
                target: locations.id,
                set: { ...rows[ 0 ] }
            })
            .returning();
        return upserted.map(c => mapDbLocationToDomain(DbLocationSchema.parse(c)));
    }

    async updateScenes(updates: Scene[]) {
        if (!db) throw new Error("Database not initialized");

        return Promise.all(updates.map(async scene => {
            const [ row ] = await db.update(scenes)
                .set({ ...scene, updatedAt: new Date() } as any)
                .where(eq(scenes.id, scene.id))
                .returning();
            return row;
        }));
    };

    async updateSceneStatus(sceneId: string, status: string): Promise<Scene> {
        if (!db) throw new Error("Database not initialized");

        const [ updated ] = await db.update(scenes)
            .set({ status: status as any })
            .where(eq(scenes.id, sceneId))
            .returning();
        return mapDbSceneToDomain(DbSceneSchema.parse(updated));
    }

    // Characters
    async getProjectCharacters(projectId: string): Promise<Character[]> {
        if (!db) throw new Error("Database not initialized");

        const records = await db.select().from(characters).where(eq(characters.projectId, projectId));
        return records.map(c => DbCharacterSchema.parse(c) as unknown as Character);
    }

    async getCharactersByIds(ids: string[]): Promise<Character[]> {
        if (!db) throw new Error("Database not initialized");

        if (ids.length === 0) {
            return [];
        }

        const records = await db
            .select()
            .from(characters)
            .where(inArray(characters.id, ids));
        return records.map(c => DbCharacterSchema.parse(c) as unknown as Character);
    }

    // Locations
    async getProjectLocations(projectId: string): Promise<Location[]> {
        if (!db) throw new Error("Database not initialized");

        const records = await db.select().from(locations).where(eq(locations.projectId, projectId));
        return records.map(l => DbLocationSchema.parse(l) as unknown as Location);
    }

    async getLocationsByIds(ids: string[]): Promise<Location[]> {
        if (!db) throw new Error("Database not initialized");

        if (ids.length === 0) {
            return [];
        }
        const records = await db
            .select()
            .from(locations)
            .where(inArray(locations.id, ids));
        return records.map(l => DbLocationSchema.parse(l) as unknown as Location);
    }

    async updateSceneAssets(sceneId: string, assetKey: string, history: any) {
        if (!db) throw new Error("Database not initialized");

        await db.update(scenes)
            .set({
                assets: sql`COALESCE(assets, '{}'::jsonb) || jsonb_build_object(${assetKey}::text, ${JSON.stringify(history)}::jsonb)`,
                updatedAt: new Date()
            } as any)
            .where(eq(scenes.id, sceneId));
    }

    async updateCharacterAssets(characterId: string, assetKey: string, history: any) {
        if (!db) throw new Error("Database not initialized");

        await db.update(characters)
            .set({
                assets: sql`COALESCE(assets, '{}'::jsonb) || jsonb_build_object(${assetKey}::text, ${JSON.stringify(history)}::jsonb)`,
                updatedAt: new Date()
            } as any)
            .where(eq(characters.id, characterId));
    }

    async updateLocationAssets(locationId: string, assetKey: string, history: any) {
        if (!db) throw new Error("Database not initialized");

        await db.update(locations)
            .set({
                assets: sql`COALESCE(assets, '{}'::jsonb) || jsonb_build_object(${assetKey}::text, ${JSON.stringify(history)}::jsonb)`,
                updatedAt: new Date()
            } as any)
            .where(eq(locations.id, locationId));
    }

    async updateProjectAssets(projectId: string, assetKey: string, history: any) {
        if (!db) throw new Error("Database not initialized");

        await db.update(projects)
            .set({
                assets: sql`COALESCE(assets, '{}'::jsonb) || jsonb_build_object(${assetKey}::text, ${JSON.stringify(history)}::jsonb)`,
                updatedAt: new Date()
            } as any)
            .where(eq(projects.id, projectId));
    }
}
