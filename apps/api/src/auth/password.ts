import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/**
 * Password hashing with Node's built-in scrypt (no native dependency).
 * Format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>, so parameters can be raised
 * later and old hashes still verify.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join('$');
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
};

/**
 * A hash to verify against when the account does not exist, so a login attempt
 * for an unknown email costs the same time as a wrong password.
 */
export const DUMMY_HASH_PROMISE: Promise<string> = hashPassword(randomBytes(24).toString('base64'));
