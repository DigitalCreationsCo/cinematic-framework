import { defineConfig } from "drizzle-kit";

if (!process.env.POSTGRES_URL) {
  throw new Error("POSTGRES_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./src/shared/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL,
  },
  schemaFilter: [ "public" ],
});
