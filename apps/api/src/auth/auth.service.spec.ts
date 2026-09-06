import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../repositories/memory.repository';
import { loadEnv } from '../config/env';
import { AuthService, InvalidCredentialsError } from './auth.service';
import { hashPassword, verifyPassword } from './password';
import { RateLimitedError, RateLimiter, RATE_RULES } from './rate-limit';
import { readCookie } from './cookies';
import type { Request } from 'express';

const env = loadEnv({ NODE_ENV: 'test', SESSION_TTL_DAYS: '7' } as NodeJS.ProcessEnv);
const ctx = { ip: '203.0.113.9', userAgent: 'vitest' };

const service = (repo = new MemoryRepository()) => ({ repo, auth: new AuthService(repo, env, new RateLimiter()) });

describe('password hashing', () => {
  it('round-trips and rejects tampering', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('AuthService', () => {
  it('registers, resolves the session token, and logs out', async () => {
    const { auth } = service();
    const issued = await auth.register({ email: 'Ada@Example.com', password: 'lovelace-1843!', displayName: 'Ada' }, ctx);
    expect(issued.state.user.email).toBe('ada@example.com');
    expect(issued.state.workspace.ownerId).toBe(issued.state.user.id);
    expect(issued.state.workspace.slug).toBe('ada');
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const principal = await auth.resolve(issued.token);
    expect(principal?.user.id).toBe(issued.state.user.id);
    expect(principal?.session.id).toBe(issued.state.session.id);

    await auth.logout(issued.state.session.id);
    expect(await auth.resolve(issued.token)).toBeNull();
    expect(await auth.resolve('garbage')).toBeNull();
  });

  it('rejects duplicate emails and wrong passwords with stable codes', async () => {
    const { auth } = service();
    await auth.register({ email: 'grace@example.com', password: 'cobol-forever-1959', displayName: 'Grace' }, ctx);
    await expect(auth.register({ email: 'GRACE@example.com', password: 'another-password', displayName: 'Grace 2' }, ctx)).rejects.toMatchObject({ code: 'email_taken' });
    await expect(auth.login({ email: 'grace@example.com', password: 'wrong-password' }, ctx)).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(auth.login({ email: 'nobody@example.com', password: 'whatever-12345' }, ctx)).rejects.toBeInstanceOf(InvalidCredentialsError);
    const ok = await auth.login({ email: 'Grace@Example.com', password: 'cobol-forever-1959' }, ctx);
    expect(ok.state.user.displayName).toBe('Grace');
  });

  it('gives a second account with the same name a distinct workspace slug', async () => {
    const { auth } = service();
    const a = await auth.register({ email: 'a@example.com', password: 'password-number-1', displayName: 'Team' }, ctx);
    const b = await auth.register({ email: 'b@example.com', password: 'password-number-2', displayName: 'Team' }, ctx);
    expect(a.state.workspace.slug).toBe('team');
    expect(b.state.workspace.slug).toMatch(/^team-[0-9a-f]{6}$/);
  });

  it('changing the password revokes every other session', async () => {
    const { auth } = service();
    const first = await auth.register({ email: 'lin@example.com', password: 'initial-password-1', displayName: 'Lin' }, ctx);
    const second = await auth.login({ email: 'lin@example.com', password: 'initial-password-1' }, ctx);
    const principal = await auth.resolve(second.token);
    expect(principal).not.toBeNull();
    const revoked = await auth.changePassword(principal!, { currentPassword: 'initial-password-1', newPassword: 'rotated-password-2' });
    expect(revoked).toBe(1);
    expect(await auth.resolve(first.token)).toBeNull();
    expect(await auth.resolve(second.token)).not.toBeNull();
    await expect(auth.login({ email: 'lin@example.com', password: 'initial-password-1' }, ctx)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect((await auth.login({ email: 'lin@example.com', password: 'rotated-password-2' }, ctx)).state.user.id).toBe(first.state.user.id);
  });

  it('slides the expiry only when the session has been idle for a while', async () => {
    const { auth } = service();
    const issued = await auth.register({ email: 'slide@example.com', password: 'sliding-window-1', displayName: 'Slide' }, ctx);
    const soon = Date.now() + 60_000;
    const untouched = await auth.resolve(issued.token, soon);
    expect(untouched?.session.expiresAt).toBe(issued.state.session.expiresAt);
    const later = Date.now() + 10 * 60_000;
    const touched = await auth.resolve(issued.token, later);
    expect(Date.parse(touched!.session.expiresAt)).toBe(later + 7 * 24 * 60 * 60 * 1000);
  });

  it('lets the seeded demo account sign in only when a password is configured', async () => {
    const withoutPassword = service();
    await expect(withoutPassword.auth.login({ email: 'demo@madproducts.ai', password: 'anything-at-all-1' }, ctx)).rejects.toBeInstanceOf(InvalidCredentialsError);
    const withPassword = service(new MemoryRepository({ demoPasswordHash: await hashPassword('operator-password-1'), demoEmail: 'owner@example.com' }));
    const issued = await withPassword.auth.login({ email: 'owner@example.com', password: 'operator-password-1' }, ctx);
    expect(issued.state.workspace.slug).toBe('mad-products');
  });
});

describe('RateLimiter', () => {
  it('allows the burst, then throws with a retry hint, then refills', () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < RATE_RULES.loginPerEmail.burst; i += 1) limiter.consume('k', RATE_RULES.loginPerEmail, now);
    expect(() => limiter.consume('k', RATE_RULES.loginPerEmail, now)).toThrow(RateLimitedError);
    try {
      limiter.consume('k', RATE_RULES.loginPerEmail, now);
    } catch (error) {
      expect((error as RateLimitedError).getStatus()).toBe(429);
      expect((error as RateLimitedError).details).toMatchObject({ retryAfterSeconds: expect.any(Number) });
    }
    // 5 per minute → one token every 12 seconds.
    expect(() => limiter.consume('k', RATE_RULES.loginPerEmail, now + 12_500)).not.toThrow();
    expect(() => limiter.consume('other', RATE_RULES.loginPerEmail, now)).not.toThrow();
  });
});

describe('readCookie', () => {
  const req = (cookie?: string) => ({ headers: cookie === undefined ? {} : { cookie } }) as unknown as Request;
  it('finds the named cookie among others and decodes it', () => {
    expect(readCookie(req('theme=dark; mad_session=abc%2Fdef; other=1'), 'mad_session')).toBe('abc/def');
    expect(readCookie(req('theme=dark'), 'mad_session')).toBeNull();
    expect(readCookie(req(), 'mad_session')).toBeNull();
    expect(readCookie(req('mad_session_old=zzz; mad_session=real'), 'mad_session')).toBe('real');
  });
});
