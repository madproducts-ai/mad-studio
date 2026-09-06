import { loadEnv } from '../config/env';
import { createDatabase } from './client';
import { integrations, users, workspaces } from './schema';
import { DEMO_USER, DEMO_WORKSPACE, INTEGRATION_CATALOG } from './seed-data';

/** Idempotent seed: demo user, demo workspace, and the integration catalog. */
const run = async (): Promise<void> => {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to seed.');
  const handle = createDatabase(env.DATABASE_URL);
  try {
    await handle.db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values({ id: DEMO_USER.id, email: DEMO_USER.email, displayName: DEMO_USER.displayName, avatarUrl: DEMO_USER.avatarUrl, plan: DEMO_USER.plan })
        .onConflictDoNothing();
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
    console.log(`seeded demo user, workspace and ${INTEGRATION_CATALOG.length} integrations`);
  } finally {
    await handle.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
