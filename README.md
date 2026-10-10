# Chronos

University timetable generator. Imports structured academic data, generates
timetables with a deterministic constraint solver, validates them
independently, and supports safe editing with lock-and-regenerate.
`requirements.md` is the source of truth for scope and domain rules.

Stack: TypeScript, Next.js 15 (App Router, React 19), PostgreSQL via
Drizzle ORM, Redis + BullMQ for background jobs, Vitest. Web app only;
mobile is out of scope.

## What exists

- `src/core/domain.ts` - the canonical domain contract (Problem, Session,
  Placement, Solution, Finding). This is the integration boundary between
  the solver, the validator, and the rest of the application.
- `src/core/fixtures.ts` - shared known-feasible / known-infeasible /
  consecutive-lab / locked-placement test problems. Their IDs
  (`slot-d0-p0`, `room-r1`, `fac-f1`, `grp-g1`, `ses-s1`) are load-bearing
  for solver and validator tests.
- `src/db/` - normalized 24-table academic schema (Drizzle, PostgreSQL),
  from institution down to scheduled sessions, locks, generation runs,
  validation findings, versions, approvals, and audit events. Every
  institution-owned table carries an `institution_id` scope column with a
  real foreign key. The initial migration is generated in
  `src/db/migrations/`.
- `src/solver/`, `src/validator/` - constraint solver and independent
  validator (built separately; see their own code and tests).
- `src/app/` - a minimal Next.js shell: root layout, placeholder home page,
  Tailwind. No product screens.
- `tests/` - Vitest suites for the fixtures and for schema constraints.
  Schema tests run the generated migration against PGlite (an in-memory
  Postgres engine), so foreign keys, unique constraints, and check
  constraints are verified against real DDL.
- `docker-compose.yml` - Postgres 16 and Redis 7 with healthchecks.
- `.github/workflows/ci.yml` - typecheck, lint, and tests on push and PR.

## What does not exist yet

- Product screens (upload, validation report, timetable grid/editor,
  approval and publish flows, exports).
- API routes, authentication, and RBAC.
- Workbook (Excel) import/export (the `exceljs` dependency is declared,
  nothing is built on it).
- Background job wiring (BullMQ/Redis dependencies are declared, no worker
  runs yet).
- Notifications, versioned publishing workflow, audit UI.

## Getting started

```sh
pnpm install
docker compose up -d          # Postgres 16 + Redis 7
cp .env.example .env
pnpm db:migrate               # apply migrations from src/db/migrations
pnpm dev                      # http://localhost:3000
```

## Development

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm format
pnpm db:generate              # regenerate migrations after schema changes
```

Note: the repo pins TypeScript 6.x because typescript-eslint does not yet
support TypeScript 7.0 (`tsc --noEmit` and all tooling pass on 6.0.3).

A previous Python/FastAPI prototype is preserved on the `python-prototype`
branch for reference; the Python/React Native directions in
`requirements.md` section 11/14 are superseded by this TypeScript stack.
