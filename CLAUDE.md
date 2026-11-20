# Magnetic

An AI app builder on StateUI: people sign in, describe an app, and an agent builds it live. This folder is its own
git repo (`punyts/magnetic`) inside the punyts workspace; read `../CLAUDE.md` first. Design docs are in the workspace,
`../docs/design/magnetic-*.md`: `magnetic-v1.md` (M1–M7), `magnetic-postgres.md`, `statenet-relays.md`,
`magnetic-hosting.md`, `magnetic-m8.md`, then payments, feedback, admin and `magnetic-beta.md`. `src/server/options.ts`
(`HELP_TEXT`) is the list of options, and the README's table follows it.

## Run it locally (from the workspace root)
1. `npm run magnetic:db`: Postgres in Docker on `127.0.0.1:5433` (start Docker Desktop first).
2. `npm run magnetic:build` after changing Magnetic or a library it uses: the server runs from `dist/`.
3. Then one of:
   - `npm run magnetic:beta`: the beta as the host runs it (`beta.dev.env`: $5 each for 100 places, $500 a month),
     seeded with people to sign in as. Launch config `magnetic-beta`.
   - `npm run magnetic:beta-full`: the same with all 100 places taken.
   - `npm run magnetic`: no beta; dev users alice and bob. `npm run magnetic:dev` builds the UI libraries first.
   - `npm run magnetic:live`: the real Claude API, with `ANTHROPIC_API_KEY` from the workspace `.env`. Costs money.
4. Open `http://127.0.0.1:4300/`, never `localhost`: the sign-in cookie and redirects are on the origin it listens on.

All of these use `--migrate`, `--mock-provider` (sign in as a random test person) and, except `live`, `--mock-agent`
(scripted, no API calls). `npm run magnetic:reset` deletes the local database volume and starts it empty.

### The seeded beta (`--seed beta|beta-full`, `src/testing/betaPersonas.ts`)
Sign-in buttons for: Avery, the admin (owns the beta org, opens `/admin`); Nell, never signed in (takes a place on
first sign-in; only fresh after a reset); Hana ($2.40 of $5); Nico ($4.90, one more turn); Uma (all $5 used, chat
off); Gia (used $5, $3 more given by the admin); Theo (used $5, bought $10). Testers hold the other places, leaving 3
open (or none when full). The seed runs on every start and only adds what is missing. Seeded mock turns cost about
$0.15, so allowances move.

## Tests
- `npm test` (vitest, `src/**/*.test.ts`). Database tests use `magneticTestDatabase()` (`src/testing/testDb.ts`): a
  fresh schema with every migration, on `PUNYTS_TEST_DATABASE_URL` or the dev database by default.
- `npm run typecheck`, and `npm run e2e`: Playwright over `e2e/*.spec.ts` at desktop and phone sizes. It builds, then
  starts `e2e/server.mjs` on 4390 (+1 runtime, +2 a control port, +3 stand-ins for an API, an OAuth provider and
  Stripe), with dev users alice to gina (erin is the admin). Outside CI Playwright reuses a server already on 4390,
  which serves a stale `dist`: stop it after rebuilding.
- CI (`.github/workflows/ci.yml`) checks out the workspace on `develop` with every library's `develop` beside this
  repo, so a change that needs a library change passes only once that library's `develop` has it.

## Code
- `src/server/startMagnetic.ts` wires everything and still holds the sign-in, editor (`/edit/<id>/…`), `/new` and
  share routes. Other routes are `src/server/<x>Routes.ts`, each exporting `<x>Routes(context)` that returns
  `(request, response, method, path) => Promise<boolean>`, chained in `startMagnetic.ts`.
- Options: `src/server/options.ts` parses flags and `MAGNETIC_*` variables; update `HELP_TEXT`, `options.test.ts` and
  the README with a new one. Development-only switches (dev users, HTTP providers, `--mock-agent`, `--seed`) refuse a
  non-loopback host.
- Pages are StateUI apps, not server HTML (`docs/design/magnetic-editable.md`). Sign-in, the link page, Your apps
  and the editor are each a `PageSpec` (`src/pages/PageSpec.ts`): an English definition with de/fr/es locales and a
  contract of emits a copy must keep. Magnetic's code version is made with the agent's own tools in the system
  workspace (`src/pages/PageApps.ts`); admins edit drafts in the pages workspace and publish them to `magnetic_page`
  (`src/pages/SitePages.ts`); each person's Your apps and editor are copies they may change (`src/pages/PersonPages.ts`).
  A page talks to its server only through `$.data` and emits, never by node path. Versions are remade when a hash of
  their definition and texts changes, under an advisory lock (`src/storage/exclusive.ts`) because two servers race.
- Text: `src/http/text.ts` has `EN` and `DE`/`FR`/`ES` typed against it (a missing key fails the typecheck), and pages
  have their own `*Text.ts` files (billing, connections, data, orgs). Admin pages are English only.
- Database: Magnetic's tables are in `migrations/NNNN_name.sql` (next is 0015); StateUI's workspace tables come from
  `@punyts/stateui-pg`. Only stateui-pg's workspace tables have row-level security; a new workspace-scoped table must
  copy that policy and be queried through `db.transaction(…, { workspaceIds })`. The server connects as
  `magnetic_app`, granted every table by `migrate --app-role`; the development `magnetic` user is a superuser and
  bypasses row-level security. A migration that rewrites workspace rows sets no workspace, so it lifts `FORCE ROW
  LEVEL SECURITY` for its own transaction and restores it (`0013_effect_function_paths.sql`).
- Generate UUIDs in code (`randomUUID()`), not in SQL.
- Budgets: `src/agent/Budgets.ts` (spend ledger `agent_request`; credits, payments and gifts in `agent_credit`); the
  beta's places: `src/beta/Beta.ts`.
- Logging: `report.info(message, fields)`; never log secrets, prompts or provider response bodies.
- `brand/logo.svg` and `src/http/logo.ts` hold the same logo; keep them the same.
