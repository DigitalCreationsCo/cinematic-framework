import * as dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";
import { CheckpointerManager } from "../src/workflow/checkpointer-manager";
import { RunnableConfig } from "@langchain/core/runnables";

/**
 * Recursively replaces bucket references
 */
function replaceBucketReferences(obj: any, oldBucket: string, newBucket: string): any {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
        return obj.replace(new RegExp(oldBucket, 'g'), newBucket);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => replaceBucketReferences(item, oldBucket, newBucket));
    }

    if (typeof obj === 'object') {
        const updated: any = {};
        for (const [ key, value ] of Object.entries(obj)) {
            updated[ key ] = replaceBucketReferences(value, oldBucket, newBucket);
        }
        return updated;
    }

    return obj;
}

async function updateCheckpointDirectly(
    threadId: string,
    oldBucket: string,
    newBucket: string
): Promise<void> {
    const postgresUrl = process.env.POSTGRES_URL;
    if (!postgresUrl) throw new Error("POSTGRES_URL not set");

    // Initialize checkpointer to use its decoder
    const checkpointerManager = new CheckpointerManager(postgresUrl);
    await checkpointerManager.init();
    const checkpointer = await checkpointerManager.getCheckpointer();

    // Direct DB connection
    const pool = new Pool({ connectionString: postgresUrl });
    const client = await pool.connect();

    try {
        console.log(`\n=== Updating Thread: ${threadId} ===`);
        console.log(`Replacing: ${oldBucket} → ${newBucket}\n`);

        await client.query('BEGIN');

        // Get the latest checkpoint using checkpointer (to decode it properly)
        const config: RunnableConfig = {
            configurable: { thread_id: threadId },
        };

        const checkpoint = await checkpointer.get(config);
        if (!checkpoint) {
            console.log("✗ No checkpoint found");
            await client.query('ROLLBACK');
            return;
        }

        console.log("Current checkpoint ID:", checkpoint.id);
        console.log("Current channel_values keys:", Object.keys(checkpoint.channel_values || {}).length);

        // Update the channel_values
        const updatedChannelValues = replaceBucketReferences(
            checkpoint.channel_values,
            oldBucket,
            newBucket
        );

        const originalStr = JSON.stringify(checkpoint.channel_values);
        const updatedStr = JSON.stringify(updatedChannelValues);

        if (originalStr === updatedStr) {
            console.log("ℹ No bucket references found - nothing to update");
            await client.query('ROLLBACK');
            return;
        }

        const occurrences = (originalStr.match(new RegExp(oldBucket, 'g')) || []).length;
        console.log(`Found ${occurrences} occurrence(s) of "${oldBucket}"`);

        const updatedCheckpoint = {
            ...checkpoint,
            channel_values: updatedChannelValues,
        };

        const serde = (checkpointer).serde;
        if (!serde || !serde.dumpsTyped) {
            throw new Error("Cannot access checkpointer serializer");
        }

        const [ _, serializedData ] = await serde.dumpsTyped(updatedCheckpoint);

        const checkpointJson = Buffer.from(serializedData).toString('utf-8');

        const serializedType = 'json';

        console.debug('Update parameters: ');
        console.debug('checkpoint: ', checkpointJson);
        console.debug('type: ', serializedType);
        console.debug('thread_id: ', threadId);
        console.debug('checkpoint_ns: ', '');
        console.debug('checkpoint_id: ', checkpoint.id);

        console.debug('Updating checkpoint ID:', checkpoint.id);

        const updateResult = await client.query(
            `UPDATE checkpoints 
       SET checkpoint = $1, type = $2
       WHERE thread_id = $3 
         AND checkpoint_id = $4
       RETURNING checkpoint_ns, checkpoint_id`,
            [ updatedCheckpoint, serializedType, threadId, checkpoint.id ]
        );

        if (updateResult.rowCount === 0) {
            throw new Error("No rows updated - checkpoint not found in database");
        }

        console.log(`Updated ${updateResult.rowCount} row(s). Namespace(s):`, updateResult.rows.map(r => r.checkpoint_ns));

        await client.query('COMMIT');
        console.log(`✓ Successfully updated checkpoint in database`);

        // Verify the update
        console.log("\nVerifying update...");
        const verifyCheckpoint = await checkpointer.get(config);
        const verifyStr = JSON.stringify(verifyCheckpoint?.channel_values || {});
        const hasNew = verifyStr.includes(newBucket);
        const hasOld = verifyStr.includes(oldBucket);

        console.log(`Contains "${newBucket}": ${hasNew ? "✓" : "✗"}`);
        console.log(`Contains "${oldBucket}": ${hasOld ? "✗ (STILL PRESENT!)" : "✓ (removed)"}`);

        if (hasNew && !hasOld) {
            console.log("\n✓✓✓ Update successful and verified!");
        } else {
            console.log("\n⚠ Update may not have worked as expected");
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("✗ Error updating checkpoint:", error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

async function bulkUpdateCheckpoints(
    threadIds: string[],
    oldBucket: string,
    newBucket: string
): Promise<void> {
    let successCount = 0;
    let failCount = 0;

    for (const threadId of threadIds) {
        try {
            await updateCheckpointDirectly(threadId, oldBucket, newBucket);
            successCount++;
        } catch (error) {
            console.error(`Failed to update ${threadId}:`, error);
            failCount++;
        }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log("BULK UPDATE SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total: ${threadIds.length}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failCount}`);
}

// Main execution
async function main() {
    const threadIds = [
        "video_1765360860268",
    ];

    await bulkUpdateCheckpoints(
        threadIds,
        "cinematic-framework-5",
        "cinematic-framework-6"
    );
}

if (import.meta.main) {
    main().catch(console.error);
}