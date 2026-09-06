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
| `GET` | `/health` | Storage kind and reachability |
| `GET/POST` | `/projects` · `GET/PATCH/DELETE /projects/:id` | Workspace-scoped |
| `GET/PUT` | `/projects/:id/document` | Optimistic lock via `baseVersion` → `409 conflict` |
| `GET` | `/projects/:id/document/history` | Append-only versions |
| `POST` | `/generations` | Creates the project when `projectId` is omitted |
| `GET` | `/generations/:id/events` | SSE; resume with `Last-Event-ID` or `?after=` |
| `POST` | `/generations/:id/cancel` | Resolves after the terminal event |
| `GET` | `/presets?designSystem=&q=` | Component library |
| `GET` | `/integrations` · `/projects/:id/integrations` | Catalog and attachments |
| `POST/GET` | `/projects/:id/deployments` | Simulated pipeline: queued → building → live |

Every error is `{ statusCode, code, message, details?, requestId }`. Every response is validated against `@mad/schema` on both sides of the wire.

## Deploy

**GitHub Pages (web app, browser mode).** Every push to `main` that passes CI is deployed by
[deploy-pages.yml](.github/workflows/deploy-pages.yml) to <https://madproducts-ai.github.io/mad-studio/>.
The `pages` build configuration sets `baseHref: /mad-studio/`, swaps in `environment.pages.ts`
(no API URL, so the studio runs the planner in the browser and saves projects locally, shown as
**Browser mode**), and `scripts/finalize-pages.mjs` adds `404.html` for deep links plus `.nojekyll`.

To serve from a custom domain (for example `studio.madproducts.ai`): add a `CNAME` file with the
domain to `apps/web/public`, change `baseHref` in the `pages` configuration to `/`, point
`apiUrl` in `environment.pages.ts` at a hosted API, and configure the DNS record GitHub Pages asks for.

**API.** `npm run build:api` produces a single `apps/api/dist/main.js`; run it with `DATABASE_URL`
set on any Node 22+ host with PostgreSQL reachable.
## Environment

See `apps/api/.env.example`. The API reads `apps/api/.env` (real environment variables win). `PORT` defaults to `4100`, `GENERATION_PACE` scales stream timing (`0` = instant, for tests). In development any loopback origin passes CORS.

## Brand

Tokens, typography scale, motion rules and the mark's usage live in [`media/BRAND.md`](media/BRAND.md).
