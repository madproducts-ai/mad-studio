-- MAD Studio · initial schema
-- Mirrors apps/api/src/db/schema.ts and packages/schema/src/entities.ts.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE plan AS ENUM ('free', 'pro', 'team', 'enterprise');
CREATE TYPE design_system AS ENUM ('tailwind', 'material', 'wordpress');
CREATE TYPE project_status AS ENUM ('draft', 'building', 'ready', 'deployed', 'archived');
CREATE TYPE authored_by AS ENUM ('ai', 'user');
CREATE TYPE generation_status AS ENUM ('queued', 'planning', 'generating', 'wiring', 'complete', 'failed', 'cancelled');
CREATE TYPE integration_status AS ENUM ('pending', 'connected', 'error');
CREATE TYPE deployment_target AS ENUM ('preview', 'production');
CREATE TYPE deployment_status AS ENUM ('queued', 'building', 'live', 'failed', 'rolled-back');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  display_name  text NOT NULL,
  avatar_url    text,
  plan          plan NOT NULL DEFAULT 'free',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspaces_slug_key ON workspaces (slug);
CREATE INDEX workspaces_owner_idx ON workspaces (owner_id);

CREATE TABLE projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              text NOT NULL,
  slug              text NOT NULL,
  description       text,
  design_system     design_system NOT NULL DEFAULT 'tailwind',
  status            project_status NOT NULL DEFAULT 'draft',
  last_prompt       text,
  document_version  integer NOT NULL DEFAULT 0 CHECK (document_version >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX projects_workspace_slug_key ON projects (workspace_id, slug);
CREATE INDEX projects_workspace_updated_idx ON projects (workspace_id, updated_at DESC);
CREATE INDEX projects_status_idx ON projects (status);

CREATE TABLE project_documents (
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version        integer NOT NULL CHECK (version >= 0),
  document       jsonb NOT NULL,
  authored_by    authored_by NOT NULL,
  generation_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, version)
);
CREATE INDEX project_documents_generation_idx ON project_documents (generation_id);

CREATE TABLE generations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt         text NOT NULL CHECK (char_length(prompt) BETWEEN 4 AND 2000),
  design_system  design_system NOT NULL,
  seed           integer,
  status         generation_status NOT NULL DEFAULT 'queued',
  duration_ms    integer,
  node_count     integer,
  error          text,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generations_project_created_idx ON generations (project_id, created_at DESC);
CREATE INDEX generations_status_idx ON generations (status);

CREATE TABLE generation_events (
  generation_id  uuid NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  seq            integer NOT NULL CHECK (seq >= 0),
  type           text NOT NULL,
  payload        jsonb NOT NULL,
  at             timestamptz NOT NULL,
  PRIMARY KEY (generation_id, seq)
);

CREATE TABLE integrations (
  slug         text PRIMARY KEY,
  name         text NOT NULL,
  category     text NOT NULL,
  description  text NOT NULL,
  scopes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  docs_url     text NOT NULL,
  status       text NOT NULL DEFAULT 'available'
);

CREATE TABLE project_integrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration_slug  text NOT NULL REFERENCES integrations(slug) ON DELETE RESTRICT,
  status            integration_status NOT NULL DEFAULT 'pending',
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX project_integrations_project_slug_key ON project_integrations (project_id, integration_slug);

CREATE TABLE deployments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_version  integer NOT NULL,
  target            deployment_target NOT NULL,
  status            deployment_status NOT NULL DEFAULT 'queued',
  url               text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deployments_project_created_idx ON deployments (project_id, created_at DESC);

-- Keep updated_at honest without relying on application code.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_integrations_set_updated_at BEFORE UPDATE ON project_integrations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER deployments_set_updated_at BEFORE UPDATE ON deployments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
