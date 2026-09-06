-- MAD Studio · authentication
-- Password hashes on users, opaque server-side sessions. Mirrors apps/api/src/db/schema.ts.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash     text,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at     timestamptz;

CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ip            text,
  user_agent    text,
  revoked_at    timestamptz,
  CONSTRAINT sessions_expires_after_created CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

COMMIT;
