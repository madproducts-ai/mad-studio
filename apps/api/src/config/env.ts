import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  HOST: z.string().min(1).default('0.0.0.0'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  DATABASE_URL: z
    .string()
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? s.trim() : undefined))
    .pipe(z.string().url().optional()),
  GENERATION_PACE: z.coerce.number().min(0).max(10).default(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export const ENV = Symbol('ENV');

/**
 * Minimal .env reader (no dependency). Real environment variables always win;
 * the file only fills in what is missing. Looks in the API package directory
 * and the current working directory.
 */
export const loadDotEnv = (target: NodeJS.ProcessEnv = process.env): void => {
  const candidates = [resolve(process.cwd(), '.env'), resolve(__dirname, '../../.env')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (target[key] === undefined) target[key] = value;
    }
    return;
  }
};

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  if (source === process.env) loadDotEnv(source);
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${lines}`);
  }
  return parsed.data;
};
