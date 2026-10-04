import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` doesn't need a database, so builds without DATABASE_URL
  // (e.g. the hosted in-browser demo) still work. Migrations require the real URL.
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/unset" },
});
