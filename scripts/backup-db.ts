
import * as dotenv from "dotenv";
dotenv.config();

import { db } from "../src/shared/db";
import { sql } from "drizzle-orm";
import fs from "fs";

async function backup() {
    console.log("Starting database backup (raw SQL mode)...");
    const data: any = {};
    
    // We use raw SQL because the current DB schema might not match the code schema
    const tables = ["users", "projects", "characters", "locations", "scenes", "jobs"];

    try {
        for (const table of tables) {
            console.log(`Backing up ${table}...`);
            try {
                const result = await db.execute(sql.raw(`SELECT * FROM "${table}"`));
                data[table] = result.rows;
                console.log(`  -> Saved ${result.rowCount} rows from ${table}`);
            } catch (e: any) {
                if (e.code === '42P01') { // undefined_table
                    console.log(`  -> Table ${table} does not exist in DB, skipping.`);
                    data[table] = [];
                } else {
                    throw e;
                }
            }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `backup-${timestamp}.json`;
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
        console.log(`✅ Backup saved to ${filename}`);
        process.exit(0);
    } catch (error) {
        console.error("❌ Backup failed:", error);
        process.exit(1);
    }
}

backup();
