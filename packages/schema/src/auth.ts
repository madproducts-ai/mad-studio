import { z } from 'zod';
import { UserSchema, WorkspaceSchema } from './entities';

/**
 * Authentication contracts. Sessions are opaque server-side tokens delivered
 * in an HttpOnly cookie; the API never returns the raw token in a body, so the
 * client only ever sees the resolved state below.
 */

export const EmailSchema = z.string().trim().toLowerCase().email().max(200);
export const PasswordSchema = z.string().min(10, 'Use at least 10 characters.').max(200);

export const RegisterRequestSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    displayName: z.string().trim().min(1).max(80),
  })
  .strict();
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .object({
    email: EmailSchema,
    password: z.string().min(1).max(200),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: PasswordSchema,
  })
  .strict();
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const AuthStateSchema = z.object({
  user: UserSchema,
  workspace: WorkspaceSchema,
  session: z.object({
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  }),
});
export type AuthState = z.infer<typeof AuthStateSchema>;
