import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadEnv } from '../config/env';

/**
 * Minimal forward-only SQL migrator. Each file in apps/api/drizzle runs once,
 * inside its own transaction, and is recorded in `schema_migrations`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../drizzle');

const run = async (): Promise<void> => {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(resolve(migrationsDir, file), 'utf8');
      // Migration files manage their own BEGIN/COMMIT so DDL and bookkeeping commit together.
      await sql.unsafe(body.replace(/COMMIT;\s*$/, '') + `INSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`);
      console.log(`applied ${file}`);
      count += 1;
    }
    console.log(count === 0 ? 'database is up to date' : `applied ${count} migration(s)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
