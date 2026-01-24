import { build as viteBuild } from "vite";
import { rm } from "fs/promises";
import { execSync } from "child_process";
import path from "path";

async function buildAll() {
  console.log("🧹 Cleaning dist...");
  await rm("dist", { recursive: true, force: true });

  console.log("🎨 Building Client (Vite)...");
  await viteBuild({ configFile: "./src/vite.config.ts" });

  console.log("⚙️  Building Server (TSC)...");
  try {
    execSync("npx tsgo --project ./tsconfig.json", { stdio: "inherit" });
  } catch (error) {
    console.error("❌ TypeScript compilation failed.");
    process.exit(1);
  }

  console.log("✅ Build Complete.");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});