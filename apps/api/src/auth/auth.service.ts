import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthState, ChangePasswordRequest, LoginRequest, RegisterRequest, Session, User, Workspace } from '@mad/schema';
import { AppError, NotFoundError } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { REPOSITORY, type Repository } from '../repositories/repository';
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from './password';
import { RATE_RULES, RateLimiter } from './rate-limit';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface Principal {
  user: User;
  workspace: Workspace;
  session: Session;
}

export interface IssuedSession {
  state: AuthState;
  /** Raw token for the cookie. Never persisted, never returned in a body. */
  token: string;
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super('invalid_credentials', 'That email and password do not match.', HttpStatus.UNAUTHORIZED);
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super('unauthenticated', 'Sign in to continue.', HttpStatus.UNAUTHORIZED);
  }
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'workspace';

/**
 * Email + password accounts with opaque, hashed, sliding-expiry sessions.
 * Tokens are 256-bit random, stored only as SHA-256, and refreshed at most
 * every few minutes so a busy session does not write on every request.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private readonly ttlMs: number;

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(ENV) private readonly env: Env,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {
    this.ttlMs = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  get sessionTtlSeconds(): number {
    return Math.floor(this.ttlMs / 1000);
  }

  async register(input: RegisterRequest, ctx: RequestContext): Promise<IssuedSession> {
    this.limiter.consume(`register:ip:${ctx.ip ?? 'unknown'}`, RATE_RULES.registerPerIp);
    const existing = await this.repo.users.findByEmail(input.email);
    if (existing) throw new AppError('email_taken', 'An account with this email already exists. Sign in instead.', HttpStatus.CONFLICT);
    const passwordHash = await hashPassword(input.password);
    const user = await this.repo.users.create({ email: input.email, displayName: input.displayName, passwordHash });
    const workspace = await this.repo.workspaces.create(user.id, `${input.displayName}'s workspace`, await this.uniqueWorkspaceSlug(input.displayName));
    this.logger.log(`Registered ${user.id}`);
    return this.issue(user, workspace, ctx);
  }

  async login(input: LoginRequest, ctx: RequestContext): Promise<IssuedSession> {
    this.limiter.consume(`login:ip:${ctx.ip ?? 'unknown'}`, RATE_RULES.loginPerIp);
    this.limiter.consume(`login:email:${input.email}`, RATE_RULES.loginPerEmail);
    const user = await this.repo.users.findByEmail(input.email);
    const storedHash = user ? await this.repo.users.getPasswordHash(user.id) : null;
    // Always run a verification so unknown accounts take the same time as wrong passwords.
    const ok = await verifyPassword(input.password, storedHash ?? (await DUMMY_HASH_PROMISE));
    if (!user || !storedHash || !ok) throw new InvalidCredentialsError();
    const workspace = await this.workspaceFor(user);
    await this.repo.users.touchLogin(user.id);
    return this.issue(user, workspace, ctx);
  }

  async logout(sessionId: string): Promise<void> {
    await this.repo.sessions.revoke(sessionId);
  }

  async changePassword(principal: Principal, input: ChangePasswordRequest): Promise<number> {
    const storedHash = await this.repo.users.getPasswordHash(principal.user.id);
    if (!storedHash || !(await verifyPassword(input.currentPassword, storedHash))) throw new InvalidCredentialsError();
    await this.repo.users.setPassword(principal.user.id, await hashPassword(input.newPassword));
    return this.repo.sessions.revokeAllForUser(principal.user.id, principal.session.id);
  }

  /** Resolves a raw cookie token to a principal, sliding the expiry when the session is in active use. */
  async resolve(token: string, now = Date.now()): Promise<Principal | null> {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
    const session = await this.repo.sessions.findActiveByTokenHash(this.hashToken(token));
    if (!session) return null;
    const user = await this.repo.users.findById(session.userId);
    if (!user) return null;
    const workspace = await this.workspaceFor(user);
    const lastSeen = Date.parse(session.lastSeenAt);
    if (now - lastSeen > 5 * 60_000) {
      const lastSeenAt = new Date(now).toISOString();
      const expiresAt = new Date(now + this.ttlMs).toISOString();
      await this.repo.sessions.touch(session.id, lastSeenAt, expiresAt);
      return { user, workspace, session: { ...session, lastSeenAt, expiresAt } };
    }
    return { user, workspace, session };
  }

  toState(principal: Principal): AuthState {
    return {
      user: principal.user,
      workspace: principal.workspace,
      session: { id: principal.session.id, createdAt: principal.session.createdAt, expiresAt: principal.session.expiresAt },
    };
  }

  private async issue(user: User, workspace: Workspace, ctx: RequestContext): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url');
    const session = await this.repo.sessions.create({
      userId: user.id,
      tokenHash: this.hashToken(token),
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
      ip: ctx.ip,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
    });
    return { state: this.toState({ user, workspace, session }), token };
  }

  private async workspaceFor(user: User): Promise<Workspace> {
    const existing = await this.repo.workspaces.findDefaultForUser(user.id);
    if (existing) return existing;
    // Accounts created before workspaces were mandatory get one lazily.
    return this.repo.workspaces.create(user.id, `${user.displayName}'s workspace`, await this.uniqueWorkspaceSlug(user.displayName));
  }

  private async uniqueWorkspaceSlug(base: string): Promise<string> {
    const root = slugify(base);
    if (!(await this.repo.workspaces.slugExists(root))) return root;
    for (let i = 0; i < 5; i += 1) {
      const candidate = `${root}-${randomBytes(3).toString('hex')}`;
      if (!(await this.repo.workspaces.slugExists(candidate))) return candidate;
    }
    throw new NotFoundError('Workspace slug', root);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

export { UnauthenticatedError as Unauthenticated };
