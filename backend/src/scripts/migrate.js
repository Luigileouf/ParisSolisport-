import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../migrations");

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      file_name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await pool.query("SELECT file_name FROM schema_migrations");
  return new Set(result.rows.map((row) => row.file_name));
}

async function applyMigration(fileName) {
  const filePath = path.join(migrationsDir, fileName);
  const sql = await fs.readFile(filePath, "utf8");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (file_name) VALUES ($1)", [fileName]);
    await client.query("COMMIT");
    // eslint-disable-next-line no-console
    console.log(`Applied migration: ${fileName}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of files) {
    if (applied.has(fileName)) {
      // eslint-disable-next-line no-console
      console.log(`Skipping already applied migration: ${fileName}`);
      continue;
    }
    await applyMigration(fileName);
  }
}

run()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
