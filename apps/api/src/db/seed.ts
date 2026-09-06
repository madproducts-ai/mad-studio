import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password';
import { loadEnv } from '../config/env';
import { createDatabase } from './client';
import { integrations, users, workspaces } from './schema';
import { DEMO_USER, DEMO_WORKSPACE, INTEGRATION_CATALOG } from './seed-data';

/**
 * Idempotent seed: demo user, demo workspace, and the integration catalog.
 * With SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD set, the demo account gets that
 * email and a password so its owner can sign in; the password is re-hashed on
 * every run so rotating the secret and re-seeding is enough to change it.
 */
const run = async (): Promise<void> => {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to seed.');
  const handle = createDatabase(env.DATABASE_URL);
  try {
    const adminHash = env.SEED_ADMIN_PASSWORD ? await hashPassword(env.SEED_ADMIN_PASSWORD) : null;
    const adminEmail = env.SEED_ADMIN_EMAIL ?? DEMO_USER.email;
    await handle.db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values({ id: DEMO_USER.id, email: adminEmail, displayName: DEMO_USER.displayName, avatarUrl: DEMO_USER.avatarUrl, plan: DEMO_USER.plan, passwordHash: adminHash })
        .onConflictDoNothing();
      if (adminHash) {
        await tx.update(users).set({ email: adminEmail, passwordHash: adminHash }).where(eq(users.id, DEMO_USER.id));
      }
      await tx
        .insert(workspaces)
        .values({ id: DEMO_WORKSPACE.id, ownerId: DEMO_WORKSPACE.ownerId, name: DEMO_WORKSPACE.name, slug: DEMO_WORKSPACE.slug })
        .onConflictDoNothing();
      for (const item of INTEGRATION_CATALOG) {
        await tx
          .insert(integrations)
          .values({ slug: item.slug, name: item.name, category: item.category, description: item.description, scopes: item.scopes, docsUrl: item.docsUrl, status: item.status })
          .onConflictDoUpdate({
            target: integrations.slug,
            set: { name: item.name, category: item.category, description: item.description, scopes: item.scopes, docsUrl: item.docsUrl, status: item.status },
          });
      }
    });
    console.log(`seeded demo user (${adminEmail}, password ${adminHash ? 'set' : 'not set'}), workspace and ${INTEGRATION_CATALOG.length} integrations`);
  } finally {
    await handle.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
