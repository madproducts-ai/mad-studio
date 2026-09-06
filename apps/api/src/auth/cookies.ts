import type { Request, Response } from 'express';

export const SESSION_COOKIE = 'mad_session';

/** Minimal Cookie header parser; the API only ever reads one cookie. */
export const readCookie = (req: Request, name: string): string | null => {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};

export interface CookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

/**
 * HttpOnly, SameSite=Lax, host-only. The API and the studio are siblings under
 * one registrable domain, so Lax still sends the cookie on the studio's calls
 * (including EventSource with credentials) while blocking third-party sites.
 */
export const setSessionCookie = (res: Response, token: string, options: CookieOptions): void => {
  const attrs = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${options.maxAgeSeconds}`];
  if (options.secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
};

export const clearSessionCookie = (res: Response, secure: boolean): void => {
  const attrs = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
};

/** Client IP: Cloudflare's header first, then the proxy chain, then the socket. */
export const clientIp = (req: Request): string | null => {
  const cf = req.header('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? null;
};
