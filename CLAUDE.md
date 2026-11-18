# Magnetic

An AI app builder on StateUI: people sign in, describe an app, and an agent builds it live. This folder is its own
git repo (`punyts/magnetic`) inside the punyts workspace; see `../CLAUDE.md` for the workspace. Design docs are in the
workspace, `../docs/design/magnetic-*.md` (start with `magnetic-v1.md`; the beta is `magnetic-beta.md`), and the
README lists every option.

## Run it locally (from the workspace root)
1. `npm run magnetic:db`: Postgres in Docker on `127.0.0.1:5433` (start Docker Desktop first).
2. `npm run magnetic:build` after changing Magnetic or a library it uses: the server runs from `dist/`.
3. Then one of:
   - `npm run magnetic:beta`: the beta as the host runs it (`beta.dev.env`: $5 each for 100 places, $500 a month),
     seeded with people to sign in as. Launch config `magnetic-beta`.
   - `npm run magnetic:beta-full`: the same with all 100 places taken.
   - `npm run magnetic`: no beta; dev users alice and bob.
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
- `npm test` (vitest, `src/**/*.test.ts`): many need Postgres through `PUNYTS_TEST_DATABASE_URL`
  (`postgres://magnetic:magnetic@127.0.0.1:5433/magnetic`); each file gets its own schema.
- `npm run typecheck`, and `npm run e2e` (Playwright, `e2e/*.spec.ts`; builds, then starts `e2e/server.mjs` on port
  4390 at desktop and phone sizes).
- CI (`.github/workflows/ci.yml`) checks out the workspace on `develop` with every library beside this repo, so a
  change that needs a library change only passes once that library's `develop` has it.

## Code
- `src/server/startMagnetic.ts` wires everything; routes are split into `src/server/*Routes.ts`; `options.ts` parses
  flags and `MAGNETIC_*` environment variables (keep its help text and the README table in step).
- Everything is in Postgres (`migrations/`, plus `@punyts/stateui-pg`'s). The server connects as a role that
  row-level security holds; the development `magnetic` user is a superuser and bypasses it, so tests of isolation use
  the app role.
- Budgets: `src/agent/Budgets.ts` (spend ledger `agent_request`, credits `agent_credit`); the beta's places:
  `src/beta/Beta.ts`.
- Page text is in `src/http/text.ts` in four languages: change all of them.
- `brand/logo.svg` and `src/http/logo.ts` hold the same logo; keep them the same.
- Development-only switches (dev users, mock provider, mock agent, seed) refuse to run on a non-loopback host.
