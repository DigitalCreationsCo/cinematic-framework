import * as dotenv from "dotenv";
dotenv.config();

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { RunnableConfig, } from "@langchain/core/runnables";
import { CheckpointerManager } from "../src/workflow/checkpointer-manager";
import { v7 as uuidv7 } from 'uuid';

type SourceType = "fork" | "input" | "loop" | "update";

async function testSourceParameterPut(
  checkpointer: PostgresSaver,
  config: RunnableConfig,
  source: SourceType,
  testValue: string
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing source: "${source}"`);
  console.log("=".repeat(60));

  const checkpoint = await checkpointer.get(config);

  const modified = {
    ...checkpoint,
    id: checkpoint?.id || uuidv7(),
    ts: checkpoint?.ts || uuidv7(),
    v: checkpoint?.v || checkpointer.getNextVersion(checkpoint?.v),
    versions_seen: checkpoint?.versions_seen || {},
    channel_versions: checkpoint?.channel_versions || {},
    channel_values: {
      ...checkpoint?.channel_values || {},
      [ `testField_${source}` ]: testValue
    }
  };

  try {
    await checkpointer.put(
      {
        ...checkpoint,
        configurable: {
          ...config.configurable,
          checkpoint_ns: "",
          v: checkpointer.getNextVersion(checkpoint?.v),
        }
      },
      modified,
      { source, step: 0, parents: {} },
      modified.channel_versions
    );
    console.log(`✓ Put with source="${source}" succeeded`);
  } catch (error: any) {
    console.log(`✗ Put with source="${source}" failed:`, error.message);
    return { source, success: false, found: false, checkpointChanged: false };
  }

  const after = await checkpointer.get(config);
  const afterStr = JSON.stringify(after?.channel_values);
  const found = afterStr.includes(testValue);
  const checkpointIdChanged = after?.id !== checkpoint?.id;

  console.log("After - Checkpoint ID:", after?.id);
  console.log(`Checkpoint ID changed: ${checkpointIdChanged}`);
  console.log(`Contains "${testValue}": ${found}`);
  console.log(`Field exists in checkpoint: ${!!after?.channel_values?.[ `testField_${source}` ]}`);

  return {
    source,
    success: true,
    found,
    checkpointChanged: checkpointIdChanged,
    beforeId: checkpoint?.id,
    afterId: after?.id
  };
}

async function testSourceParameterPutWrite(
  checkpointer: PostgresSaver,
  config: RunnableConfig,
  source: SourceType,
  testValue: string
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing source: "${source}"`);
  console.log("=".repeat(60));

  const checkpoint = await checkpointer.get(config);

  const modified = {
    ...checkpoint,
    channel_values: {
      ...checkpoint?.channel_values || {},
      [ `testField_${source}` ]: testValue
    }
  };

  try {
    await checkpointer.putWrites(
      {
        ...checkpoint,
        configurable: {
          ...config.configurable,
          checkpoint_ns: "",
          v: checkpointer.getNextVersion(checkpoint?.v),
          checkpoint_id: checkpoint?.id,
        }
      },
      Object.entries(modified),
      uuidv7(),
    );
    console.log(`✓ Put with source="${source}" succeeded`);
  } catch (error: any) {
    console.log(`✗ Put with source="${source}" failed:`, error.message);
    return { source, success: false, found: false, checkpointChanged: false };
  }

  const after = await checkpointer.get(config);
  const afterStr = JSON.stringify(after?.channel_values);
  const found = afterStr.includes(testValue);
  const checkpointIdChanged = after?.id !== checkpoint?.id;

  console.log("After - Checkpoint ID:", after?.id);
  console.log(`Checkpoint ID changed: ${checkpointIdChanged}`);
  console.log(`Contains "${testValue}": ${found}`);
  console.log(`Field exists in checkpoint: ${!!after?.channel_values?.[ `testField_${source}` ]}`);

  return {
    source,
    success: true,
    found,
    checkpointChanged: checkpointIdChanged,
    beforeId: checkpoint?.id,
    afterId: after?.id
  };
}

async function testAllSources(threadId: string) {
  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl) throw new Error("POSTGRES_URL not set");

  const checkpointerManager = new CheckpointerManager(postgresUrl);
  await checkpointerManager.init();
  const checkpointer = await checkpointerManager.getCheckpointer();

  const config: RunnableConfig = {
    configurable: {
      thread_id: threadId,
      checkpoint_ns: ""
    },
  };

  console.log("\n" + "=".repeat(60));
  console.log("INITIAL STATE");
  console.log("=".repeat(60));
  const initial = await checkpointer.get(config);
  console.log("Initial checkpoint ID:", initial?.id);
  console.log("Initial channel_values keys:", Object.keys(initial?.channel_values || {}).length);
  console.log("Initial timestamp:", initial?.ts);

  const sources: SourceType[] = [ "input", "loop", "update", "fork" ];
  const results = [];

  for (const source of sources) {
    const testValue = `TEST_${source.toUpperCase()}_${Date.now()}`;
    const result = await testSourceParameterPut(checkpointer, config, source, testValue);
    results.push(result);

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log("\nResults by source type:\n");

  const table = results.map(r => ({
    Source: r.source,
    "Put Success": r.success ? "✓" : "✗",
    "Value Found": r.found ? "✓" : "✗",
    "ID Changed": r.checkpointChanged ? "✓" : "✗",
  }));
  console.table(table);

  console.log("\nConclusion:");
  const workingSources = results.filter(r => r.success && r.found);
  if (workingSources.length > 0) {
    console.log(`✓ Sources that successfully persist changes: ${workingSources.map(r => r.source).join(", ")}`);
  } else {
    console.log("✗ No source type successfully persisted changes!");
  }

  const idChangingSources = results.filter(r => r.checkpointChanged);
  if (idChangingSources.length > 0) {
    console.log(`ℹ Sources that create new checkpoint IDs: ${idChangingSources.map(r => r.source).join(", ")}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("FINAL STATE CHECK");
  console.log("=".repeat(60));
  const final = await checkpointer.get(config);
  const finalStr = JSON.stringify(final?.channel_values || "");

  console.log("Final checkpoint ID:", final?.id);
  console.log("\nTest values still present:");
  for (const source of sources) {
    const found = finalStr.includes(`TEST_${source.toUpperCase()}`);
    console.log(`  - ${source}: ${found ? "✓ Found" : "✗ Not found"}`);
  }
}

async function testAllSourcesPutWrite(threadId: string) {
  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl) throw new Error("POSTGRES_URL not set");

  const checkpointerManager = new CheckpointerManager(postgresUrl);
  await checkpointerManager.init();
  const checkpointer = await checkpointerManager.getCheckpointer();

  const config: RunnableConfig = {
    configurable: {
      thread_id: threadId,
      checkpoint_ns: ""
    },
  };

  console.log("\n" + "=".repeat(60));
  console.log("INITIAL STATE");
  console.log("=".repeat(60));
  const initial = await checkpointer.get(config);
  console.log("Initial checkpoint ID:", initial?.id);
  console.log("Initial channel_values keys:", Object.keys(initial?.channel_values || {}).length);
  console.log("Initial timestamp:", initial?.ts);

  const sources: SourceType[] = [ "input", "loop", "update", "fork" ];
  const results = [];

  for (const source of sources) {
    const testValue = `TEST_${source.toUpperCase()}_${Date.now()}`;
    const result = await testSourceParameterPutWrite(checkpointer, config, source, testValue);
    results.push(result);

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log("\nResults by source type:\n");

  const table = results.map(r => ({
    Source: r.source,
    "Put Write Success": r.success ? "✓" : "✗",
    "Value Found": r.found ? "✓" : "✗",
    "ID Changed": r.checkpointChanged ? "✓" : "✗",
  }));
  console.table(table);

  console.log("\nConclusion:");
  const workingSources = results.filter(r => r.success && r.found);
  if (workingSources.length > 0) {
    console.log(`✓ Sources that successfully persist changes: ${workingSources.map(r => r.source).join(", ")}`);
  } else {
    console.log("✗ No source type successfully persisted changes!");
  }

  const idChangingSources = results.filter(r => r.checkpointChanged);
  if (idChangingSources.length > 0) {
    console.log(`ℹ Sources that create new checkpoint IDs: ${idChangingSources.map(r => r.source).join(", ")}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("FINAL STATE CHECK");
  console.log("=".repeat(60));
  const final = await checkpointer.get(config);
  const finalStr = JSON.stringify(final?.channel_values || "");

  console.log("Final checkpoint ID:", final?.id);
  console.log("\nTest values still present:");
  for (const source of sources) {
    const found = finalStr.includes(`TEST_${source.toUpperCase()}`);
    console.log(`  - ${source}: ${found ? "✓ Found" : "✗ Not found"}`);
  }
}

testAllSources("video_1765360860268").catch(console.error);
await new Promise(resolve => setTimeout(resolve, 3000));

testAllSourcesPutWrite("video_1764172747467").catch(console.error);
