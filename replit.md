# Argus — SSC English Mock Analyzer

A local-first dashboard for analyzing SSC CGL English sectional mocks, finding weak topics, and turning mistakes into a focused revision plan.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/mock-analyzer/src/App.tsx` — dashboard views, mock CRUD, import/export, and analysis calculations
- `artifacts/mock-analyzer/src/index.css` — Argus visual theme and responsive layout
- `VERCEL_DEPLOY.md` — GitHub-to-Vercel deployment steps
- `vercel.json` — root Vercel build and static output configuration

## Architecture decisions

- The first version is local-first: mock history is stored in browser localStorage, so it needs no database, account, API key, or server.
- JSON export/import is the portable backup path between browsers and devices.
- The app is a static Vite build with a root Vercel configuration so it can deploy directly from GitHub.

## Product

- Overview dashboard with accuracy, average score, consistency, attempt disposition, trend, topic ranking, and next action.
- Topic map with strength/build/repair signals.
- Mock log with add, edit, delete, search, and date-range filtering.
- Revision queue generated from the weakest observed topics.
- JSON/CSV import and JSON export.

## User preferences

- Keep the analyzer easy to import from GitHub and deploy on Vercel.
- Prioritize practical topic-level analysis over a basic mock list.

## Gotchas

- Browser data is device-local; export before clearing site data or changing devices.
- CSV imports use the headers documented in the import dialog.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
