import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL,
});

export const db = drizzle(pool);

async function dropAllTables() {
    console.log("⏳ Dropping all tables...");

    try {
        await db.execute(sql`
      DO $$ 
      DECLARE
          r RECORD;
      BEGIN
          -- Loop through all tables in the 'public' schema
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
              EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP;
      END $$;
    `);

        console.log("✅ All tables dropped successfully.");
    } catch (error) {
        console.error("❌ Failed to drop tables:", error);
    } finally {
        process.exit(0);
    }
}

dropAllTables();