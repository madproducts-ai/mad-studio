import { createParamDecorator, type ExecutionContext, Inject, Injectable, type CanActivate, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { User, Workspace } from '@mad/schema';
import { REPOSITORY, type Repository } from '../repositories/repository';
import { DEMO_USER_ID } from '../db/seed-data';

/**
 * Development identity. Until the hosted auth provider is wired, every request
 * resolves to the seeded demo user, or to the user named by `x-mad-user-id`.
 * The guard still fails closed: an unknown id is a 401, not a silent fallback.
 */
export interface Principal {
  user: User;
  workspace: Workspace;
}

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}

@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header('x-mad-user-id');
    const userId = header && /^[0-9a-f-]{36}$/i.test(header) ? header : DEMO_USER_ID;
    const user = await this.repo.users.findById(userId);
    if (!user) throw new UnauthorizedException({ code: 'unknown_user', message: 'No user matches the supplied identity.' });
    const workspace = await this.repo.workspaces.findDefaultForUser(user.id);
    if (!workspace) throw new UnauthorizedException({ code: 'no_workspace', message: 'The user has no workspace.' });
    req.principal = { user, workspace };
    return true;
  }
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.principal) throw new UnauthorizedException({ code: 'no_principal', message: 'Request has no resolved principal.' });
  return req.principal;
});
