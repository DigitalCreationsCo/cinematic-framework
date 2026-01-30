import { build as viteBuild } from "vite";
import { build as esBuild } from "esbuild";
import path from "path";
import { rm } from "fs/promises";
import { execSync } from "child_process";

async function buildAll() {
  const root = process.cwd();
  const dist = path.resolve(root, "dist");

  await rm(dist, { recursive: true, force: true });

  console.log("🎨 Building Client...");
  await viteBuild({
    configFile: path.resolve(root, "src/server/vite.config.ts"),
    build: {
      outDir: path.resolve(dist, "server/public"),
      emptyOutDir: false,
    }
  });

  try {
    console.log("⚙️  Compiling TypeScript Projects...");
    execSync("npx tsgo -b", { cwd: process.cwd(), stdio: "inherit" });
  } catch (error) {
    console.error("❌ TypeScript compilation failed");
    process.exit(1);
  }
}
buildAll();