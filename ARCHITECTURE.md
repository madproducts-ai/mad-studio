# MAD Studio — Architecture

## One document, many surfaces

The unit of state is the **MadDocument**: a tree of typed nodes (`page → nav | sidebar | stack → section → grid → stat …`) plus the integrations and tables the planner derived. It is defined once in `packages/schema` with Zod and consumed by:

- the **planner**, which builds it and replays it as a timed event stream;
- the **API**, which persists it as append-only JSONB versions with an optimistic lock;
- the **web renderer**, which turns it into DOM with one recursive component and three design-system skins;
- the **inspector**, which patches nodes through pure tree functions (`insertNode`, `patchNode`, `moveNode`, `removeNode`).

```
prompt ──► planner.plan() ──► TimedEvent[] ──► API scheduler ──► SSE ──► StudioStore.applyEvent()
                              │                                                 │
                              └──────────── OfflineRunner (browser) ────────────┘
```

Both paths produce identical `GenerationEvent`s, so offline mode is not a degraded mode.

## Generation stream

| Event | Payload | Consumer effect |
|---|---|---|
| `status` | queued · planning · generating · wiring · complete · failed · cancelled | Status pill, timer start/stop |
| `plan` / `step` | Plan steps with state | Plan chips in the prompt bar and demo |
| `node.add` / `node.patch` / `node.remove` | Tree mutations keyed by stable `n_…` ids | Canvas grows visibly; entrance animation |
| `schema.table` | table + columns | Schema panel, persisted into `document.tables` |
| `integration.add` | slug, label, scopes | Integrations panel, persisted into `document.integrations` |
| `log` / `tokens` / `done` / `error` | Diagnostics and completion | Console, toast, completion handling |

Every event carries a monotonically increasing `seq`. The API persists events in batches, serves the backlog on `Last-Event-ID`, then joins the live subject without gaps or duplicates. The browser client drops anything at or below its last `seq`.

## Persistence

`Repository` is the only storage boundary. `PgRepository` (Drizzle + postgres.js) and `MemoryRepository` enforce the same invariants: unique `(workspace, slug)`, composite `(project_id, version)` documents, append-only events, cascading deletes. Document saves take `baseVersion`; a mismatch is a `409 conflict` that the studio surfaces with a "Reload latest" action while keeping local edits in undo history.

Outbound database calls run through `withRetry` (exponential back-off with full jitter, transient Postgres codes only).

## Web application

- **Angular 22, zoneless, signals everywhere.** Change detection is OnPush; state lives in `StudioStore`, provided at the `/studio` route so the session survives the `/studio → /studio/:id` navigation after a build.
- **Renderer** (`core/render`): `NodeView` handles all 27 node types; `DeviceFrame` supplies the `--r-*` token set for Tailwind / Material / WordPress skins and dark / light, and lays the document out at true device widths (1440, 834, 393, 412) before scaling.
- **Editing:** selection, hover, drop targets and entrance animations are coordinated through `RenderContext`. Drag-and-drop uses native HTML5 DnD with a single MIME type for presets and node moves. Undo history coalesces rapid edits to the same node and key.
- **Motion:** Motion One springs (`SPRING.ui/panel/magnetic/release/enter`), GSAP ScrollTrigger for hero parallax, CSS `linear()` spring easing for micro-interactions, and full `prefers-reduced-motion` fallbacks.
- **Design tokens:** defined once in `styles.css` under `@theme`, swapped wholesale for light mode, AAA contrast on every text token.

## Extending

- **New node type:** add it to `NODE_TYPES` and `NODE_PROP_CONTROLS` in `packages/schema`, a builder in `packages/planner/src/builders.ts`, a `@case` in `node-view.component.html`, and styles in `node-view.component.css`.
- **New capability:** add a `FeatureModule` in `packages/planner/src/modules.ts` and its vocabulary in `intents.ts`.
- **Model-backed planning:** replace `plan()`'s module assembly with a model call that emits the same `TimedEvent[]`; nothing downstream changes.
