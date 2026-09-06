import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? 'postgres://mad:mad@localhost:5432/mad_studio' },
  strict: true,
  verbose: true,
});
