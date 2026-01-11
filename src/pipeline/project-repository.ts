import { db } from "../shared/db";
import { scenes, projects, characters, locations, jobs } from "../shared/schema";
import { eq, asc, inArray, } from "drizzle-orm";
import {
    Scene, Location, Project, InitialProject,
    Character,
} from "../shared/types/pipeline.types";
import {
    DbProjectSchema, DbSceneSchema, DbCharacterSchema, DbLocationSchema, ProjectEntity,
} from "../shared/zod-db";
import { mapDbProjectToDomain } from "./helpers/domain/project-mappers";
import { mapDbSceneToDomain, mapDomainSceneToDb } from "./helpers/domain/scene-mappers";
import { mapDbCharacterToDomain, mapDomainCharacterToDb } from "./helpers/domain/character-mappers";
import { mapDbLocationToDomain, mapDomainLocationToDb } from "./helpers/domain/location-mappers";

export class ProjectRepository {

    async getProjects() {
        const records = await db.select().from(projects);
        return records;
    }

    async getProject(projectId: string): Promise<ProjectEntity> {
        const [ record ] = await db.select().from(projects).where(eq(projects.id, projectId));
        if (!record) throw new Error(`Project ${projectId} not found`);
        return DbProjectSchema.parse(record);
    }

    async getProjectFullState(projectId: string): Promise<Project> {
        const projectEntity = await this.getProject(projectId);

        const dbScenes = await db.select().from(scenes)
            .where(eq(scenes.projectId, projectId))
            .orderBy(asc(scenes.sceneIndex));

        const dbChars = await db.select().from(characters).where(eq(characters.projectId, projectId));
        const dbLocs = await db.select().from(locations).where(eq(locations.projectId, projectId));

        const domainScenes = dbScenes.map(s => mapDbSceneToDomain(DbSceneSchema.parse(s)));
        const domainCharacters = dbChars.map(c => mapDbCharacterToDomain(DbCharacterSchema.parse(c)));
        const domainLocations = dbLocs.map(l => mapDbLocationToDomain(DbLocationSchema.parse(l)));

        return mapDbProjectToDomain(
            projectEntity,
            domainScenes,
            domainCharacters,
            domainLocations,
        );
    }

    async createProject(insertProject: InitialProject): Promise<Project> {
        // Map InitialProject to DB insert
        const [ project ] = await db.insert(projects).values({
            storyboard: insertProject.storyboard,
            metadata: insertProject.metadata,
            status: insertProject.status,
            currentSceneIndex: insertProject.currentSceneIndex,
            assets: insertProject.assets,
            generationRules: insertProject.generationRules
        }).returning();

        // If InitialProject has nested items, create them
        if (insertProject.scenes && insertProject.scenes.length > 0) {
            await this.createScenes(project.id, insertProject.scenes);
        }
        if (insertProject.characters && insertProject.characters.length > 0) {
            await this.createCharacters(project.id, insertProject.characters);
        }
        if (insertProject.locations && insertProject.locations.length > 0) {
            await this.createLocations(project.id, insertProject.locations);
        }

        return this.getProjectFullState(project.id);
    }

    async updateProject(projectId: string, data: Partial<InitialProject>): Promise<Project> {
        // Only updates project table fields
        await db.update(projects)
            .set({
                metadata: data.metadata,
                metrics: data.metrics,
                currentSceneIndex: data.currentSceneIndex,
                updatedAt: new Date()
            })
            .where(eq(projects.id, projectId));
        return this.getProjectFullState(projectId);
    }

    async updateCharacters(updates: Character[]) {
        return Promise.all(updates.map(async char => {
            const [ row ] = await db.update(characters)
                .set({ ...char, updatedAt: new Date() } as any)
                .where(eq(characters.id, char.id))
                .returning();
            return row;
        }));
    };

    async updateLocations(updates: Location[]) {
        return Promise.all(updates.map(async loc => {
            const [ row ] = await db.update(locations)
                .set({ ...loc, updatedAt: new Date() } as any)
                .where(eq(locations.id, loc.id))
                .returning();
            return row;
        }));
    };

    async getScene(sceneId: string): Promise<Scene> {
        const [ record ] = await db.select().from(scenes).where(eq(scenes.id, sceneId));
        if (!record) throw new Error(`Scene ${sceneId} not found`);
        return mapDbSceneToDomain(DbSceneSchema.parse(record));
    }

    async getProjectScenes(projectId: string): Promise<Scene[]> {
        const records = await db.select().from(scenes)
            .where(eq(scenes.projectId, projectId))
            .orderBy(asc(scenes.sceneIndex));
        return records.map(r => mapDbSceneToDomain(DbSceneSchema.parse(r)));
    }

    async createScenes(projectId: string, scenesData: Scene[]): Promise<Scene[]> {
        const rows = scenesData.map(s => ({
            ...mapDomainSceneToDb(s),
            projectId // Ensure project ID override
        }));
        if (rows.length === 0) return [];

        const upserted = await db
            .insert(scenes)
            .values(rows)
            .onConflictDoUpdate({
                target: scenes.id,
                set: { ...rows[0] }
            })
            .returning();
        return upserted.map(c => mapDbSceneToDomain(DbSceneSchema.parse(c)));
    }

    async createCharacters(projectId: string, charactersData: Character[]): Promise<Character[]> {
        const rows = charactersData.map(s => ({
            ...mapDomainCharacterToDb(s),
            projectId // Ensure project ID override
        }));
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
    async createLocations(projectId: string, locationsData: Location[]): Promise<Location[]> {
        const rows = locationsData.map(s => ({
            ...mapDomainLocationToDb(s),
            projectId // Ensure project ID override
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
        return Promise.all(updates.map(async scene => {
            const [ row ] = await db.update(scenes)
                .set({ ...scene, updatedAt: new Date() } as any)
                .where(eq(scenes.id, scene.id))
                .returning();
            return row;
        }));
    };

    async updateSceneStatus(sceneId: string, status: string): Promise<Scene> {
        const [ updated ] = await db.update(scenes)
            .set({ status: status as any })
            .where(eq(scenes.id, sceneId))
            .returning();
        return mapDbSceneToDomain(DbSceneSchema.parse(updated));
    }

    // Characters
    async getProjectCharacters(projectId: string): Promise<Character[]> {
        const records = await db.select().from(characters).where(eq(characters.projectId, projectId));
        return records.map(c => DbCharacterSchema.parse(c) as unknown as Character);
    }

    async getCharactersByIds(ids: string[]): Promise<Character[]> {
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
        const records = await db.select().from(locations).where(eq(locations.projectId, projectId));
        return records.map(l => DbLocationSchema.parse(l) as unknown as Location);
    }

    async getLocationsByIds(ids: string[]): Promise<Location[]> {
        if (ids.length === 0) {
            return [];
        }
        const records = await db
            .select()
            .from(locations)
            .where(inArray(locations.id, ids));
        return records.map(l => DbLocationSchema.parse(l) as unknown as Location);
    }
}
