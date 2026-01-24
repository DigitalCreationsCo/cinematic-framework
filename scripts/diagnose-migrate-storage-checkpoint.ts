import * as dotenv from "dotenv";
dotenv.config();

import { RunnableConfig } from "@langchain/core/runnables";
import { CheckpointerManager } from "../src/workflow/checkpointer-manager";
import { Pool } from "pg";

/**
 * Diagnostic script to understand what's happening with checkpoints
 */
async function diagnoseCheckpoint(threadId: string, oldMatchValue: string, newMatchValue: string) {
    const postgresUrl = process.env.POSTGRES_URL;
    if (!postgresUrl) throw new Error("POSTGRES_URL not set");

    const checkpointerManager = new CheckpointerManager(postgresUrl);
    await checkpointerManager.init();

    const checkpointer = await checkpointerManager.getCheckpointer();
    const pool = new Pool({ connectionString: postgresUrl });

    console.log(`\n=== Diagnosing Thread: ${threadId} ===\n`);

    const runnableConfig: RunnableConfig = {
        configurable: { thread_id: threadId },
    };

    const checkpoint = await checkpointer.get(runnableConfig);

    console.log("1. Checkpointer.get() result:");
    console.log("   - Checkpoint ID:", checkpoint?.id);
    console.log("   - Checkpoint exists:", !!checkpoint);
    if (checkpoint?.channel_values) {
        const valuesStr = JSON.stringify(checkpoint.channel_values);
        const hasOldValue = valuesStr.includes(oldMatchValue);
        const hasNewValue = valuesStr.includes(newMatchValue);

        console.log(`   - Contains '${oldMatchValue}':`, hasOldValue);
        console.log(`   - Contains '${newMatchValue}':`, hasNewValue);
    }

    console.log("\n2. Database query results:");
    const result = await pool.query(
        `SELECT 
      thread_id, 
      checkpoint_ns, 
      checkpoint_id, 
      parent_checkpoint_id,
      type,
      metadata
     FROM checkpoints 
     WHERE thread_id = $1
     ORDER BY checkpoint_id DESC`,
        [ threadId ]
    );

    console.log(`   - Total checkpoints in DB: ${result.rows.length}`);

    for (let i = 0; i < Math.min(3, result.rows.length); i++) {
        const row = result.rows[ i ];
        console.log(`\n   Checkpoint ${i + 1}:`);
        console.log(`   - checkpoint_id: ${row.checkpoint_id}`);
        console.log(`   - checkpoint_ns: ${row.checkpoint_ns}`);
        console.log(`   - parent_checkpoint_id: ${row.parent_checkpoint_id}`);
        console.log(`   - type: ${row.type}`);
        console.log(`   - metadata:`, row.metadata);
        console.log(`   - created_at: ${row.created_at}`);
    }

    console.log("\n3. Checkpoint channel_values content:");
    const dataResult = await pool.query(
        `SELECT checkpoint_id, checkpoint 
     FROM checkpoints 
     WHERE thread_id = $1
     ORDER BY checkpoint_id DESC 
     LIMIT 3`,
        [ threadId ]
    );

    for (const row of dataResult.rows) {
        const checkpointData = row.checkpoint;
        const channelValues = checkpointData?.channel_values || {};
        const valuesStr = JSON.stringify(channelValues);
        const hasOldValue = valuesStr.includes(oldMatchValue);
        const hasNewValue = valuesStr.includes(newMatchValue);

        console.log(`\n   Checkpoint ID: ${row.checkpoint_id}`);
        console.log(`   - Contains '${oldMatchValue}':`, hasOldValue);
        console.log(`   - Contains '${newMatchValue}':`, hasNewValue);
        console.log(`   - Channel values keys:`, Object.keys(channelValues));
    }

    console.log("\n4. Testing different config options:");

    const configWithCheckpointId = {
        configurable: {
            thread_id: threadId,
            checkpoint_id: result.rows[ 0 ]?.checkpoint_id
        },
    };

    const checkpointById = await checkpointer.get(configWithCheckpointId);
    console.log("   - With checkpoint_id specified:", !!checkpointById);

    const configWithNs = {
        configurable: {
            thread_id: threadId,
            checkpoint_ns: result.rows[ 0 ]?.checkpoint_ns || ""
        },
    };

    const checkpointByNs = await checkpointer.get(configWithNs);
    console.log("   - With checkpoint_ns specified:", !!checkpointByNs);

    await pool.end();

    console.log("\n=== Diagnosis Complete ===\n");
}

const threadId = "video_1765360860268";
const oldMatchValue = "cinematic-framework-5";
const newMatchValue = "cinematic-framework-6";

diagnoseCheckpoint(threadId, oldMatchValue, newMatchValue).catch(console.error);