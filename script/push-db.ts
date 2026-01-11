
import * as dotenv from "dotenv";
dotenv.config();

import { execSync } from "child_process";

try {
    console.log("Generating migrations...");
    execSync("npx drizzle-kit generate", { stdio: "inherit", env: process.env });

    console.log("Applying migrations...");
    execSync("npx drizzle-kit migrate", { stdio: "inherit", env: process.env });
} catch (e) {
    console.error("Migration failed");
    process.exit(1);
}
