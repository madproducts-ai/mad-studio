import { type CanActivate, createParamDecorator, type ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { AuthService, type Principal, UnauthenticatedError } from './auth.service';
import { readCookie, SESSION_COOKIE } from './cookies';
import { IS_PUBLIC } from './public.decorator';

export type { Principal } from './auth.service';

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CLIENT_HEADER = 'x-mad-client';

/**
 * Resolves the session cookie to a principal and fails closed. Routes marked
 * @Public() pass through anonymously. State-changing requests must also carry
 * the `X-MAD-Client` header: browsers cannot attach custom headers cross-origin
 * without a CORS preflight the API only grants to the studio's origin, which
 * makes the header a cheap, robust CSRF defence for cookie-authenticated calls.
 */
@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<Request>();
    const token = readCookie(req, SESSION_COOKIE);
    const principal = token ? await this.auth.resolve(token) : null;
    if (principal) req.principal = principal;
    if (isPublic) return true;
    if (!principal) throw new UnauthenticatedError();
    if (!SAFE_METHODS.has(req.method.toUpperCase()) && req.header(CLIENT_HEADER) !== 'web') {
      throw new AppError('client_header_missing', 'State-changing requests must include the X-MAD-Client header.', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.principal) throw new UnauthenticatedError();
  return req.principal;
});
