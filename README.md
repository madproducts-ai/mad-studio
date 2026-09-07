# MAD Studio

[![CI](https://github.com/madproducts-ai/mad-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/madproducts-ai/mad-studio/actions/workflows/ci.yml)

**Prompt to production in under 60 seconds.**
studio.madproducts.ai · AI-native platform to generate, visually edit, and deploy production-ready web and mobile applications.

```
mad-studio/
├─ apps/
│  ├─ web/        Angular 22 (zoneless, signals) · Tailwind 4 · Motion One · GSAP
│  └─ api/        NestJS 11 · Drizzle ORM · PostgreSQL · Server-Sent Events
├─ packages/
│  ├─ schema/     Zod contracts: MadDocument tree, generation events, entities, tree ops
│  └─ planner/    Deterministic prompt → document planner + 23×3 component presets
├─ media/         Brand sources (SVG), manifest, BRAND.md, build-media.mjs
└─ docker-compose.yml   Local PostgreSQL 16
```

## Quick start

```bash
npm install
npm run dev:api      # http://localhost:4100/v1  (in-memory repository when DATABASE_URL is unset)
npm run dev:web      # http://localhost:4200
```

Open the web app, type a prompt such as *"Build an internal CRM dashboard with Stripe billing and a customer support chat"*, and the interface streams onto the canvas. Click any component to edit it in the inspector.

If the API is unreachable the studio runs the same planner in the browser and saves projects to `localStorage`; the topbar shows an **Offline** badge.

## PostgreSQL

With Docker:

```bash
docker compose up -d
```

With a local PostgreSQL install (any 14+; trust or password auth on localhost):

```sql
CREATE ROLE mad LOGIN PASSWORD 'mad';
CREATE DATABASE mad_studio OWNER mad;
```

Then:

```bash
cp apps/api/.env.example apps/api/.env      # DATABASE_URL=postgres://mad:mad@127.0.0.1:5432/mad_studio
npm run db:migrate                          # applies apps/api/drizzle/*.sql, forward-only
npm run db:seed                             # demo user, workspace, integration catalog
npm run dev:api
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev:web` / `npm run dev:api` | Dev servers with watch |
| `npm run build` | Production builds for every workspace (`apps/web/dist`, `apps/api/dist/main.js`) |
| `npm run typecheck` | Strict TypeScript across all workspaces |
| `npm test` | Vitest across planner, api and web (Angular unit-test builder) |
| `npm run media:build` | Rasterise brand SVGs into favicon, icons, OG image |

## API surface (`/v1`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | Storage, planner mode (`model`/`heuristic`) and deploy target |
| `POST` | `/auth/register` · `/auth/login` · `/auth/logout` | Email + password; sets the HttpOnly `mad_session` cookie |
| `GET/POST` | `/auth/me` · `/auth/password` | Current session; changing the password revokes other sessions |
| `GET/POST` | `/projects` · `GET/PATCH/DELETE /projects/:id` | Workspace-scoped |
| `GET/PUT` | `/projects/:id/document` | Optimistic lock via `baseVersion` → `409 conflict` |
| `GET` | `/projects/:id/document/history` | Append-only versions |
| `POST` | `/generations` | Creates the project when `projectId` is omitted |
| `GET` | `/generations/:id/events` | SSE; resume with `Last-Event-ID` or `?after=` |
| `POST` | `/generations/:id/cancel` | Resolves after the terminal event |
| `GET` | `/presets?designSystem=&q=` | Component library |
| `GET` | `/integrations` · `/projects/:id/integrations` | Catalog and attachments |
| `POST/GET` | `/projects/:id/deployments` | Renders the saved version to a static page and publishes it: queued → building → live |

Every error is `{ statusCode, code, message, details?, requestId }`. Every response is validated against `@mad/schema` on both sides of the wire.

### Authentication

Accounts are email + password (scrypt). A successful register/login sets `mad_session`, an HttpOnly, SameSite=Lax cookie holding an opaque token that is stored hashed with a sliding 30-day expiry. Every other route requires it; state-changing requests must also send `X-MAD-Client: web`, which browsers can only attach after the CORS preflight the API grants to the studio origin. Login and registration are rate limited per IP and per email. The studio asks you to sign in the first time a cloud action needs it and offers **browser mode** (local projects, no account) as the alternative.

### Planner

With `ANTHROPIC_API_KEY` set, the API asks Claude (`PLANNER_MODEL`, default `claude-opus-5`, adaptive thinking, structured output validated against `AppSpecSchema` in `@mad/planner`) for an application spec and materialises it with the same builders as the deterministic planner, so every result renders and edits identically. Without a key, or when the model fails or times out, the deterministic planner answers and the console says so. The event stream contract is the same either way.

### Deployments

Deploy renders the saved document version with `@mad/export` — a static HTML renderer generated from the studio canvas CSS (`npm run sync:export-css`) — and writes `index.html`, `manifest.json` and `document.json` to `DEPLOY_EXPORT_ROOT`. Production deploys own `<slug>-<id>/` and are replaced in place; previews are immutable snapshots under `<slug>-<id>/p/<deployment>/`. The five most recent previews of a project stay reachable â€” publishing a sixth removes the oldest snapshot from disk and marks that deployment withdrawn, so the host cannot fill up with old previews. Without `DEPLOY_PUBLIC_BASE` the API serves the export root itself at `/exports/`; on the fleet the FE site serves it under `https://studio.madproducts.ai/apps/`.

## Deploy

**GitHub Pages (web app, browser mode).** Every push to `main` that passes CI is deployed by
[deploy-pages.yml](.github/workflows/deploy-pages.yml) to <https://madproducts-ai.github.io/mad-studio/> as a browser-mode demo. The workflow reads the Pages settings through `actions/configure-pages` and passes
the matching `--base-href`, so the build follows whatever domain is configured. The `pages` build
configuration swaps in `environment.pages.ts` (no API URL, so the studio runs the planner in the browser
and saves projects locally, shown as **Browser mode**), and `scripts/finalize-pages.mjs` adds `404.html`
for deep links plus `.nojekyll`.

The production site lives on the fleet origin (see IIS below); Pages stays on the repository path so the two never claim the same hostname.

**IIS on the MAD fleet origin (studio.madproducts.ai, full stack).** [deploy/deploy-iis.ps1](deploy/deploy-iis.ps1)
follows the fleet convention (vendored `Mad.Deploy 1.1.0`): site `studio` serves the production Angular build on
https :8132 and site `studioapi` hosts the Node API on https :9132, each with a :443 SNI binding on the shared
`*.madproducts.ai` certificate that Cloudflare proxies to. The API runs under AspNetCoreModuleV2 out-of-process,
which launches `node.exe` with [deploy/api/server.cjs](deploy/api/server.cjs) (it maps the module-assigned
`ASPNETCORE_PORT` onto `PORT`); configuration is injected through `<environmentVariables>` in the site's
`web.config`. The script builds both apps, stages the API runtime (bundle + pinned runtime dependencies) in
`apps/api/publish`, runs `db:migrate` and `db:seed` against PostgreSQL, publishes, binds, and verifies that
`/v1/health` reports `storage: postgres` in production. Run it elevated after copying `deploy/.env.deploy.example`
to `deploy/.env.deploy` (untracked):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\deploy-iis.ps1
```

Switches: `-SkipBuild`, `-SkipInstall`, `-SkipMigrate`. `deploy\test-mad-deploy.ps1` runs the module self-tests.
**API.** `npm run build:api` produces a single `apps/api/dist/main.js`; run it with `DATABASE_URL`
set on any Node 22+ host with PostgreSQL reachable.
## Accessibility

`npm run check:contrast` measures each piece of text against the background it actually sits on and fails on anything below WCAG AA. It covers two surfaces: a generated application rendered through the static exporter in every design system and theme at desktop and phone widths, and the studio's own interface (landing and editor) in both themes, served from `apps/web/dist`. Sixteen renderings in total. CI runs it on every push, after the build.

## Environment

See `apps/api/.env.example`. The API reads `apps/api/.env` (real environment variables win). `PORT` defaults to `4100`, `GENERATION_PACE` scales stream timing (`0` = instant, for tests). In development any loopback origin passes CORS. Auth: `SESSION_TTL_DAYS`, `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`. Planner: `ANTHROPIC_API_KEY`, `PLANNER_MODEL`, `PLANNER_EFFORT`, `PLANNER_TIMEOUT_MS`. Deploy: `DEPLOY_EXPORT_ROOT`, `DEPLOY_PUBLIC_BASE`. On the fleet these come from the untracked `deploy/.env.deploy` (see `deploy/.env.deploy.example`) and land in the API's `web.config`.

## Brand

Tokens, typography scale, motion rules and the mark's usage live in [`media/BRAND.md`](media/BRAND.md).
