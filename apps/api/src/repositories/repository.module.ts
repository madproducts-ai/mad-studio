import { Global, Logger, Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { createDatabase, type DatabaseHandle } from '../db/client';
import { MemoryRepository } from './memory.repository';
import { PgRepository } from './pg.repository';
import { REPOSITORY, type Repository } from './repository';

export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_HANDLE,
      inject: [ENV],
      useFactory: (env: Env): DatabaseHandle | null => (env.DATABASE_URL ? createDatabase(env.DATABASE_URL) : null),
    },
    {
      provide: REPOSITORY,
      inject: [DATABASE_HANDLE],
      useFactory: async (handle: DatabaseHandle | null): Promise<Repository> => {
        const logger = new Logger('Repository');
        if (!handle) {
          logger.warn('DATABASE_URL not set — using the in-memory repository. Data resets on restart.');
          return new MemoryRepository();
        }
        const repo = new PgRepository(handle.db);
        const ok = await repo.ping();
        if (!ok) throw new Error('PostgreSQL is configured but unreachable. Check DATABASE_URL.');
        logger.log('Connected to PostgreSQL.');
        return repo;
      },
    },
  ],
  exports: [REPOSITORY, DATABASE_HANDLE],
})
export class RepositoryModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle?.close();
  }
}
