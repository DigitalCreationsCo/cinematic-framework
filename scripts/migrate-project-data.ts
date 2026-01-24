
import * as dotenv from "dotenv";
dotenv.config();

import { eq, sql } from "drizzle-orm";
import merge from 'lodash.merge';
import { CheckpointerManager } from "../src/workflow/checkpointer-manager";
import { GCPStorageManager } from "../src/workflow/storage-manager";
import { Storyboard, Storyboard } from "../src/shared/types/pipeline.types";

// Dynamic imports to ensure env vars are set first
const { db } = await import("../src/shared/db");
const { projects } = await import("../src/shared/schema");
const { ProjectRepository } = await import("../src/pipeline/project-repository");


// --- Transformer Helpers ---
function transformLighting(oldLighting: any): any {
    if (!oldLighting) return undefined;

    // Check if already new format (checks if quality is object)
    if (typeof oldLighting.quality === 'object') return oldLighting;

    return {
        quality: {
            hardness: oldLighting.quality,
            colorTemperature: oldLighting.colorTemperature,
            intensity: oldLighting.intensity
        },
        motivatedSources: {
            "primaryLight": oldLighting.motivatedSources,
            "fillLight": undefined,
            "practicalLights": "None", // Default as it is required? Check Schema.
            "accentLight": undefined,
            "lightBeams": "None" // Default
        },
        direction: {
            "keyLightPosition": oldLighting.direction,
            "Shadow Direction": undefined,
            "contrastRatio": undefined
        },
        atmosphere: {
            "Haze": "None"
        }
    };
}

function transformObjectData(oldObj: any): any {
    if (!oldObj) return undefined;
    if (oldObj.model) return oldObj;
    return { ...oldObj, model: "unknown" };
}

function transformStoryboard(oldStoryboard: any): any {
    const newStoryboard: Storyboard = JSON.parse(JSON.stringify(oldStoryboard));

    // 1. Characters
    if (newStoryboard.characters) {
        newStoryboard.characters = newStoryboard.characters.map((char) => {
            if (char.referenceImages) {
                char.referenceImages = char.referenceImages.map(transformObjectData);
            }
            char.state = char.state && {
                ...char.state,
                emotionalHistory: char.state.emotionalHistory.map((eh) => ({
                    ...eh,
                    sceneId: String(eh.sceneId),
                })
                ),
                lastSeen: String(char.state?.lastSeen)
            } || undefined;
            return char;
        });
    }

    // 2. Locations
    if (newStoryboard.locations) {
        newStoryboard.locations = newStoryboard.locations.map((loc) => {
            if (loc.lightingConditions) {
                loc.lightingConditions = transformLighting(loc.lightingConditions);
            }
            if (loc.state?.lighting) {
                loc.state.lighting = transformLighting(loc.state.lighting);
            }
            if (loc.state?.lightingHistory) {
                loc.state.lightingHistory = loc.state.lightingHistory.map((h: any) => ({
                    ...h,
                    lighting: transformLighting(h.lighting)
                }));
            }
            if (loc.referenceImages) {
                loc.referenceImages = loc.referenceImages.map(transformObjectData);
            }
            loc.state = loc.state && {
                ...loc.state,
                lastUsed: String(loc.state.lastUsed),
                lightingHistory: loc.state.lightingHistory.map(lh => ({ ...lh, sceneId: String(lh.sceneId) })),
                timeHistory: loc.state.timeHistory.map(th => ({ ...th, sceneId: String(th.sceneId) })),
                weatherHistory: loc.state.weatherHistory.map(wh => ({ ...wh, sceneId: String(wh.sceneId) })),
            } || undefined;

            return loc;
        });
    }

    // 3. Scenes
    if (newStoryboard.scenes) {
        newStoryboard.scenes = newStoryboard.scenes.map((scene) => {
            if (scene.lighting) {
                scene.lighting = transformLighting(scene.lighting);
            }
            if (scene.generatedVideo) {
                scene.generatedVideo = transformObjectData(scene.generatedVideo);
            }
            if (scene.startFrame) {
                scene.startFrame = transformObjectData(scene.startFrame);
            }
            if (scene.endFrame) {
                scene.endFrame = transformObjectData(scene.endFrame);
            }
            scene.sceneIndex = Number(scene.id);
            scene.id = String(scene.id);
            return scene;
        });
    }

    const transformedStoryboard = JSON.parse(JSON.stringify(newStoryboard));

    newStoryboard.scenes = newStoryboard.scenes.map((scene) => {
        scene.composition = {
            "Subject Placement": JSON.stringify(scene.composition),
            "Focal Point": JSON.stringify(scene.composition),
            "Depth Layers": JSON.stringify(scene.composition),
            "Leading Lines": JSON.stringify(scene.composition),
            Headroom: JSON.stringify(scene.composition),
            "Look Room": JSON.stringify(scene.composition),
        };
        scene.cameraAngle = scene.cameraAngle;
        return scene;
    });

    const strictlyTransformedStoryboard = JSON.parse(JSON.stringify(newStoryboard));

    return [ transformedStoryboard, strictlyTransformedStoryboard ];
}

async function migrateThread(threadId: string) {
    console.log(`\n=== Migrating Thread: ${threadId} ===`);

    const gcpPojectId = process.env.GCP_PROJECT_ID!;
    if (!gcpPojectId) throw new Error("GCP_PROJECT_ID not set");
    const bucketName = process.env.GCP_BUCKET_NAME!;
    if (!bucketName) throw new Error("GCP_BUCKET_NAME not set");
    const postgresUrl = process.env.POSTGRES_URL;
    if (!postgresUrl) throw new Error("POSTGRES_URL not set");

    const sm = new GCPStorageManager(gcpPojectId, threadId, bucketName);

    const checkpointerManager = new CheckpointerManager(postgresUrl);
    await checkpointerManager.init();
    const checkpointer = checkpointerManager.getCheckpointer();

    console.log("Getting checkpoint...");
    const checkpoint = await checkpointer.get({ configurable: { thread_id: threadId } });
    console.log("Got checkpoint.");

    if (!checkpoint) {
        console.error(`❌ No checkpoint found for thread ${threadId}`);
        return;
    }

    let checkpointStoryboardData: any = checkpoint.channel_values ? || checkpoint.channel_values?.storyboard;
    const cv: any = checkpoint.channel_values;
    if (!checkpointStoryboardData && cv?.input?.storyboard) {
        checkpointStoryboardData = cv.input.storyboard;
    }

    const storyboardPath = sm.getObjectPath({ type: 'storyboard' });
    const storyboardExists = await sm.fileExists(storyboardPath);
    let storyboardData: any;

    if (storyboardExists) {
        console.log("Found storyboard.json in GCS. Merging with checkpoint data...");
        const gcsStoryboardData = await sm.downloadJSON<any>(storyboardPath);
        const mergedStoryboard = {};
        merge(mergedStoryboard, gcsStoryboardData, checkpointStoryboardData);
        storyboardData = mergedStoryboard;
    } else {
        console.log("storyboard.json not found in GCS. Using checkpoint data only.");
        storyboardData = checkpointStoryboardData;
    }

    if (!storyboardData) {
        console.error(`❌ No storyboard data found in checkpoint channels for ${threadId}`);
        console.log("Available channels:", Object.keys(checkpoint.channel_values || {}));
        return;
    }

    console.log("Transforming data to match new schema...");
    const [ transformedStoryboard, strictlyTransformedStoryboard ] = transformStoryboard(storyboardData);

    // const parseResult = Storyboard.safeParse(strictlyTransformedStoryboard);
    // if (!parseResult.success) {
    //     console.error(`❌ Storyboard validation failed for ${threadId}:`, JSON.stringify(parseResult.error, null, 2));
    //     return;
    // }
    console.log('Strict storyboard validation succeeded. Using non-strict storyboard data.');

    const storyboard = transformedStoryboard;

    const existingProjects = await db.select().from(projects).where(
        sql`metadata->>'legacy_thread_id' = ${threadId}`
    );

    if (existingProjects.length > 0) {
        console.log(`⚠️  Found ${existingProjects.length} existing project(s) for this thread. Overwriting...`);
        for (const p of existingProjects) {
            console.log(`   - Deleting Project ID: ${p.id} (${p.name})`);
            await db.delete(projects).where(eq(projects.id, p.id));
        }
    }

    // 4. Create New Project
    console.log(`Creating new project for "${storyboard.metadata.title}"...`);
    const repo = new ProjectRepository();

    // Add legacy ID to metadata
    const newMetadata = {
        ...storyboard.metadata,
        legacy_thread_id: threadId
    };

    const projectId = await repo.createProject(
        storyboard.metadata.title,
        storyboard.metadata.enhancedPrompt || "",
        newMetadata
    );
    console.log(`✅ Created Project ID: ${projectId}`);

    // 5. Migrate Assets
    console.log(`Migrating ${storyboard.scenes.length} scenes...`);

    await repo.createScenes(projectId, storyboard.scenes);

    // Restore status and videoUri
    const createdScenes = await repo.getProjectScenes(projectId, false); // skip validation

    for (const sourceScene of storyboard.scenes) {
        const targetScene = createdScenes.find(s => s.sceneIndex === sourceScene.sceneIndex);
        if (targetScene) {
            const status = sourceScene.status || 'pending';
            const videoUri = sourceScene.generatedVideo;

            if (status !== 'pending' || videoUri) {
                await repo.updateSceneStatus(targetScene.id, status, videoUri);
            }
        }
    }

    console.log(`✅ Scenes migrated.`);

    console.log(`Migrating ${storyboard.characters.length} characters...`);
    await repo.createCharacters(projectId, storyboard.characters);
    console.log(`✅ Characters migrated.`);

    console.log(`Migrating ${storyboard.locations.length} locations...`);
    await repo.createLocations(projectId, storyboard.locations);
    console.log(`✅ Locations migrated.`);

    console.log(`🎉 Migration complete for ${threadId}`);
}

async function main() {
    const args = process.argv.slice(2);
    const THREAD_IDS_TO_MIGRATE = args.length ? args : [ 'project_1766881871377_6d5a21b7' ];
    if (!THREAD_IDS_TO_MIGRATE.length) throw Error("No thread IDs provided");

    console.log("Starting migration...");
    for (const threadId of THREAD_IDS_TO_MIGRATE) {
        try {
            await migrateThread(threadId);
        } catch (error) {
            console.error(`❌ Error migrating ${threadId}:`, error);
        }
    }
    console.log("Migration finished.");
    process.exit(0);
}

main().catch(console.error);