# @punyts/magnetic

Magnetic is an AI app builder on StateUI. People sign in, describe an app, and watch an agent build it as a live
StateUI app. They can look at its state, edit it by hand, and share it. The design is in
`docs/design/magnetic-v1.md` in the workspace.

Built so far, each with its design doc in the workspace's `docs/design/`:
- the multi-user server (M1), sign-in through LinkedIn or any OpenID Connect provider (M2), the editor and the agent
  (M3), the state view and the hand editor (M4, M5: the inspector), and sharing (M6): `magnetic-v1.md`;
- everything in Postgres, with orgs, roles, enterprise controls and semantic search: `magnetic-postgres.md`;
- several servers as nodes of the statenet, with relays and grants of state: `statenet-relays.md`;
- hosting on AWS (M7): `magnetic-hosting.md`;
- the library, layout, screens, connections to outside APIs and the Playwright suite (M8): `magnetic-m8.md`;
- buying agent use, feedback, the admin pages and the beta: `magnetic-payments.md`, `magnetic-feedback.md`,
  `magnetic-admin.md`, `magnetic-beta.md`.

Each person gets a workspace of their own, and their apps run live behind their session. Magnetic's own pages
(sign-in, Your apps, the editor) are StateUI apps.

The logo is in `brand/`: `logo.svg`, and PNGs at 512, 300 and 100 pixels. Every page has it as its icon, the sign-in
page and the editor show it, and the server serves the file at `/assets/logo.svg` (`src/http/logo.ts` holds a copy;
keep the two the same).

## Run it

From the workspace:

```bash
npm run magnetic:db      # Postgres 16 with pgvector in Docker, on 127.0.0.1:5433 (magnetic/docker-compose.yml)
npm run magnetic:build   # the libraries Magnetic uses, Magnetic itself and the runtime bundle
npm run magnetic         # http://127.0.0.1:4300/, with the development users alice and bob, a mock provider and the mock agent
```

The other ways to run it, from the workspace:

```bash
npm run magnetic:dev        # builds the UI libraries, then npm run magnetic
npm run magnetic:live       # the real Claude API, with ANTHROPIC_API_KEY from the workspace .env; costs money
npm run magnetic:beta       # the beta as the host runs it (beta.dev.env: org beta, $5 each for 100 places, $500 a month), seeded with people to sign in as (--seed beta)
npm run magnetic:beta-full  # the same with all 100 places taken (--seed beta-full)
npm run magnetic:reset      # deletes the local database volume and starts Postgres again, empty
```

The beta's seed (`src/testing/betaPersonas.ts`, `docs/design/magnetic-beta.md`) offers a sign-in button for each of
its people: Avery, the admin; Nell, who has never signed in; Hana ($2.40 of $5 used); Nico ($4.90); Uma (all $5 used);
Gia ($3 more given by the admin); and Theo (bought $10). Testers hold the other places, leaving 3 open, or none with
`beta-full`. The seed runs on every start and adds only what is missing.

Magnetic keeps everything in Postgres (`docs/design/magnetic-postgres.md` in the workspace): people, links, spend,
chats and preferences in its own tables, and each workspace's parts, instances, persona records, uploaded files with
their bytes and preview errors in `@punyts/stateui-pg`'s. Nothing is written to disk. `npm run magnetic` applies the
migrations as it starts (`--migrate`); a server started any other way refuses a database that is behind, so run
`magnetic migrate` first.

Row-level security keeps each workspace's rows to itself: every workspace transaction names its workspace, and the
tables show nothing else. A superuser bypasses row-level security, so a hosted Magnetic connects as a role that is not
one (the development database's `magnetic` user is a superuser, which suits development only).

`npm run magnetic` runs the scripted mock agent, so the editor works without an API key and costs nothing. To use
Claude, set `ANTHROPIC_API_KEY` and start the server without `--mock-agent`:

```bash
npm run start -w @punyts/magnetic -- --dev-user alice
```

Open it at `http://127.0.0.1:4300/`, not `localhost`: the provider sends the browser back to the origin the server
listens on, and a cookie set on one host is not sent to the other.

### Sign in with LinkedIn

1. Make an app at the LinkedIn developer portal and add the product "Sign In with LinkedIn using OpenID Connect".
   For the app logo, upload `brand/logo-300.png` (LinkedIn asks for a square image of at least 100 pixels).
2. Under Auth, add the redirect URL `<public origin>/auth/linkedin/callback`. Locally that is
   `http://127.0.0.1:4300/auth/linkedin/callback`. The server prints it when it starts.
3. Start the server with the app's client id and primary client secret in the environment:

```bash
MAGNETIC_LINKEDIN_CLIENT_ID=... MAGNETIC_LINKEDIN_CLIENT_SECRET=... npm run magnetic
```

Keep the same LinkedIn app for the life of the server. LinkedIn gives each person a different subject in each app, so
a new app would make everyone a new user.

Or on its own:

```bash
node dist/cli.js migrate --database-url postgres://magnetic:magnetic@127.0.0.1:5433/magnetic
node dist/cli.js --database-url postgres://magnetic:magnetic@127.0.0.1:5433/magnetic --dev-user alice --dev-user bob
```

The commands are:
- `serve` (the default);
- `migrate`: apply the migrations, then exit;
- `import`: copy the people of an earlier, file-based Magnetic's `--data-dir` into the database (`accounts.json`, live
  sessions, `grants.json`, `budgets.json` as ledger rows, every chat, and each user's workspace folder with its parts,
  instances, persona records, files and preview errors); rows already there are left alone and a workspace that has
  parts is skipped, so it can run twice;
- `reindex`: queue every part, chat and embedded record field to be embedded again with the current model, embed them,
  then exit (after changing `--embedding`);
- `feedback`: print the latest hundred bugs, comments and feature requests sent from the editor, then exit;
- `relay-certificate`: write a key pair and a node certificate for a `statenet-relay` (`--node-id`) to `--out`, and
  print the authority key the relay checks its parents with. Needs `MAGNETIC_SECRET_KEY`.

`magnetic --help` prints the same options as this table (`HELP_TEXT` in `src/server/options.ts`).

| Option | Environment | Default | What |
|---|---|---|---|
| `--database-url <url>` | `MAGNETIC_DATABASE_URL` | none, required | Magnetic's Postgres database with pgvector |
| `--migrate` | `MAGNETIC_MIGRATE=true` | off | Applies the migrations before serving |
| `--app-role <role>` | `MAGNETIC_APP_ROLE` | none | For `migrate`: then grants this role the rows of every table. The servers connect as it; it must exist and have no superuser or `BYPASSRLS`, so row-level security holds it |
| `--embedding <kind>` | `MAGNETIC_EMBEDDING` | `local` | What makes search vectors: `local`, `hash` or `off` |
| `--model-cache <dir>` | `MAGNETIC_MODEL_CACHE` | the library's | Where the local model is kept |
| `--data-dir <dir>` | `MAGNETIC_DATA_DIR` | `./data` | For `import`: the data folder of an earlier, file-based Magnetic |
| `--port <n>` | `MAGNETIC_PORT` | `4300` | Port of the pages and sockets |
| `--runtime-port <n>` | `MAGNETIC_RUNTIME_PORT` | the next port | Port of the runtime origin, which serves only the app frame |
| `--host <address>` | `MAGNETIC_HOST` | `127.0.0.1` | Address to bind |
| `--dev-user <name>` | `MAGNETIC_DEV_USERS` (comma-separated) | none | A test user who signs in with a button and no provider; repeat for more. Loopback hosts only |
| `--seed <scenario>` | `MAGNETIC_SEED` | none | Seeds the beta's people to sign in as, for development: `beta` (3 places left) or `beta-full`. Needs `--beta-org`. Loopback hosts only |
| `--starter <kind>` | `MAGNETIC_STARTER` | `showcase` | What a new workspace holds: the component showcase, or `none` |
| `--runtime-dir <dir>` | `MAGNETIC_RUNTIME_DIR` | the bundle in `@punyts/stateui-app` | The built StateUI runtime bundle |
| `--public-origin <url>` | `MAGNETIC_PUBLIC_ORIGIN` | the address it listens on | The origin people reach the server at. Redirect URIs are `<origin>/auth/<provider>/callback`, and cookies are `Secure` when it is HTTPS |
| `--runtime-origin <url>` | `MAGNETIC_RUNTIME_ORIGIN` | `http://<host>:<runtime port>` | The origin people reach the app frame at behind a proxy, such as `https://run.magnetic.example`. Needs `--public-origin` on another host; with both, the server answers only to those two host names (and loopback, for health checks) |
| `--mock-provider` | `MAGNETIC_MOCK_PROVIDER=true` | off | Also runs a mock OpenID Connect provider that signs anyone in as a test person. Loopback hosts only |
| `--mock-agent` | `MAGNETIC_MOCK_AGENT=true` | off | A scripted agent that adds each request as a text on the app's first screen, to try the editor without an API key. Loopback hosts only |
| `--model <id>` | `MAGNETIC_MODEL` | `claude-haiku-5-5` | The model a turn uses unless the person picks another |
| `--models <ids>` | `MAGNETIC_MODELS` (comma-separated) | `claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5` | The models people may pick |
| `--effort <level>` | `MAGNETIC_EFFORT` | `high` | `low`, `medium`, `high`, `xhigh` or `max` |
| `--daily-budget <usd>` | `MAGNETIC_DAILY_BUDGET` | `1` | Dollars each person may spend per UTC day, or `off` |
| `--user-allowance <usd>` | `MAGNETIC_USER_ALLOWANCE` | none | Dollars each person may spend ever, a one-time allowance such as the beta's |
| `--allowance-users <n>` | `MAGNETIC_ALLOWANCE_USERS` | everyone | Only the first n people (by first sign-in) get the allowance; the others may buy agent use |
| `--beta-org <slug>` | `MAGNETIC_BETA_ORG` | none | The beta org: people join it through the beta link on Admin, and only its first `--allowance-users` members get the allowance. Needs `MAGNETIC_SECRET_KEY` |
| `--monthly-budget <usd>` | `MAGNETIC_MONTHLY_BUDGET` | `100` | Dollars the server may spend per UTC month |
| `--top-ups <usd,...>` | `MAGNETIC_TOP_UPS` | `10,25,50` | The amounts of agent use people may buy after their allowance |
| `--mesh-port <n>` | `MAGNETIC_MESH_PORT` | none: the server runs alone | Runs as one of several servers on one database, linking to the others and to relays on this port (`0` for any free port). Needs `MAGNETIC_SECRET_KEY` |
| `--mesh-host <address>` | `MAGNETIC_MESH_HOST` | `--host` | Address the mesh binds |
| `--mesh-url <url>` | `MAGNETIC_MESH_URL` | the address it listens on | The URL the other servers and relays reach this one's mesh at, such as `ws://magnetic-2:4310` |
| `--node-id <id>` | `MAGNETIC_NODE_ID` | its host name and a random suffix | This server's node id; for `relay-certificate`, the relay's |
| `--region <name>` | `MAGNETIC_REGION` | none | Where it runs |
| `--out <dir>` | | `.` | For `relay-certificate`: the folder to write the relay's files to |
| | `ANTHROPIC_API_KEY` | none | The Claude API key of the agent |
| | `MAGNETIC_LINKEDIN_CLIENT_ID`, `MAGNETIC_LINKEDIN_CLIENT_SECRET` | none | LinkedIn's client. Environment only, so the secret stays out of the process list |
| | `MAGNETIC_LINKEDIN_PKCE` | `false` | `true` sends a PKCE challenge to LinkedIn, which takes it only from apps it enabled as native; a web app's sign-in then fails with `invalid_client` |
| | `MAGNETIC_SECRET_KEY` | none | A random secret of 16 or more characters. It seals each org's own OpenID Connect client secret and every owner's signing key, and keeps the statenet's certificate authority. Without it there is no org sign-in, no grants of state, no mesh and no beta org |
| | `MAGNETIC_MAIL_FROM` | none | A verified Amazon SES address that invites and feedback are emailed from. Without it, an invite's link is only shown to the person who made it |
| | `MAGNETIC_MAIL_REGION` | `us-east-2` | The SES region; credentials come from the machine |
| | `MAGNETIC_OPERATOR`, `MAGNETIC_CONTACT_EMAIL` | none | Who runs the server and where privacy requests go; both or neither. Both set: `/privacy` says, without a sign-in, what Magnetic keeps, why, who else sees it and how to have it deleted |
| | `MAGNETIC_ADMIN_EMAILS` (comma-separated) | none | People whose verified email is listed are admins (`/admin`) |
| | `MAGNETIC_STRIPE_SECRET_KEY`, `MAGNETIC_STRIPE_WEBHOOK_SECRET` | none | Stripe's secret key and the signing secret of the webhook `<origin>/billing/stripe`; both, or no buying of agent use |

## How it works

- **The server is stateui-mcp's browser endpoint.** `startMagnetic` runs `startHttpServer` of `@punyts/stateui-mcp`
  with a `tenant` function. It serves the app pages, the runtime origin, the view sockets in Full mode, uploads and
  reports, and adds Magnetic's own routes: `/signin`, `/signin/dev`, `/signout`, `/` and `/assets/magnetic.css`.
  There is no `/mcp`: the agent runs in the server.
- **One workspace per user.** Each signed-in user gets their own stateui-mcp `Services`. These are over their own
  workspace in the database (`pgWorkspaceStorage(db, userId)`), with their user id as the owner (`Workspaces`). One user's parts, instances, files
  and live authorities never meet another's: an app id of another user is not found, by page, route or socket.
  - A workspace opens on the user's first request.
  - Any workspace that has had no open view socket and no request for 10 minutes is closed.
  - Past 200 open workspaces, the least recently used ones without sockets are closed.
  - A new workspace starts with the component showcase, unless `--starter none`.
- **Users and identities.** `identity` maps each sign-in identity (`<provider>:<subject>`) to a user id, a
  UUID, and keeps the user's name, email and picture. The user id owns everything. A second provider can later point
  at the same user.
- **Sessions.**
  - The cookie `magnetic_session` holds a token of 32 random bytes. It is `HttpOnly`, `SameSite=Lax` and
    `Path=/`, and `Secure` with `secureCookies`.
  - `session` keeps the token's SHA-256 hash, not the token, so the table alone opens no session.
  - A session lasts 30 days.
  - Signing out ends the session and closes that session's view sockets (1008 `Signed out`). Other sessions of the
    same user stay open.
- **Signing in with a provider** (`OidcSignIn`, on `openid-client`):
  - `GET /auth/<provider>` starts the authorization code flow with state, nonce and PKCE (S256), and scopes
    `openid profile email`.
  - The sign-in's random key goes in the cookie `magnetic_signin` (`Path=/auth`, 10 minutes). The state, nonce and
    verifier stay on the server.
  - `GET /auth/<provider>/callback` is accepted once, from that browser only. This stops login CSRF.
  - The ID token is checked against the provider's published keys, along with its issuer, audience, expiry and
    nonce. openid-client leaves the signature check off by default for tokens from the token endpoint; Magnetic
    turns it on.
  - The identity is `<provider>:<sub>`. The name, the verified email and an HTTPS picture come from the ID token and
    userinfo.
  - A failed sign-in shows the sign-in page again with the reason, and no session.
- **Without a session**, a page request is redirected to `/signin?next=<path>`, and every way of signing in returns
  to that path. Only plain paths of this server are followed. Any other request, sockets included, is refused with 401.
- **Development users.** `--dev-user alice` offers a "Sign in as alice" button, signing in as the identity
  `dev:alice`. A server bound to an address other than loopback refuses to start with development users.
- **Logic other people wrote.** Every app's logic runs in its authority on the server, as in stateui-mcp: rules,
  machines, decision tables and expressions. Magnetic registers no coded logic, so:
  - A `call` with no procedure, and an effect with no function, fail at once (`agentAnswers: false`).
  - More than 20 timers in one second stop an instance's logic until its document changes
    (`DEFAULT_LOGIC_LIMITS`).
  - A view socket that sends more than 50 frames a second, with a burst of 100, is closed (1008
    `Too many messages`).
  - The chain depth of 8 and the document and data limits of stateui-app apply as well.
- **Pages.**
  - Magnetic's own pages allow only their stylesheet, forms that post to Magnetic itself, and pictures over HTTPS.
  - They send `Referrer-Policy: same-origin`. A browser posts a form from a `no-referrer` page with `Origin: null`,
    which the same-origin check refuses.
  - Every POST must come from the same origin as the server.
- **Your apps** (`/`) is a StateUI app, `your-apps`, made in each workspace the first time and made again when
  its definition changes. It shows a grid of cards, the person's apps and then the apps shared with them, a field
  to make an app and Sign out. Magnetic writes the two lists into its data on each visit. The page listens for
  the app's `emit`s (`stateui:emit`): `open` goes to `/apps/<appId>`, `create` posts `/new`, `signout` posts
  `/signout`. The agent cannot edit it: `/edit/<its id>` and `/apps/<its id>` go to `/`.
- **An app** (`/apps/<appId>`) of the person's own fills the page, with the editor hidden. Ctrl+Shift+E (Cmd on a
  Mac) opens the editor over it and closes it again, switching the address to `/edit/<appId>` and back. The
  page names the key in `data-host-keys`, so the runtime hands it over while the app has focus. Another
  person's app, or a shared one, is served by stateui-mcp as before.
- **The editor** (`/edit/<appId>`): the app is a frame on a canvas, and the editor floats on it in rounded
  panels. At the top left are the way back to the apps, the name, the frame size (Desktop 1280×800, Tablet
  834×1112, Phone 390×844) and Open; at the top right, the view selector (Screens, Statenet, Theme, Logic) and Share, whose links open in a panel
  under it; on a rail at the left, the tools and the layers; at the bottom right, the zoom.
  - **The canvas** pans and zooms. Scrolling on the board pans it, Ctrl+scroll or a pinch zooms about the
    pointer, and dragging the board pans it. Over the app, the app gets the pointer as usual; with the Move tool
    (H) or Space held, a cover lies over the frame and the pointer moves the board. V goes back to Use; +, - and
    0 zoom in, out and to 100%; 1 fits the frame in the free space, never past 100%. The zoom control does the
    same. The view and the frame size are kept per app in the browser; a new app opens fitted, in the phone
    frame on a narrow screen.
  - At the bottom centre is a chat bar: the request, the model menu and Send. Focusing it, or its chat button,
    opens the chat above it; the close button or Escape closes it. Enter sends and Shift+Enter starts a new line.
    On a phone the rail sits in a row under the top bar.
  - **Its icons are its own.** The chat, Send, the three tools, the zoom buttons and the appearance button draw the
    glyphs of the old hand-written editor (41fa580), which the editor app carries as its own icons (`EDITOR_ICONS` in
    `src/editor/EditorApp.ts`, given to `ui_app_create` as `icons`) rather than the nearest icons of the set.
  - The page carries the same body attributes as stateui-mcp's `/apps/<appId>`, so the host script builds the live
    app frame. Every change the agent writes shows in it at once. It sends the host page's policy
    (`hostPageCsp`).
  - `POST /new` makes an app from the name typed on Your apps (lower case words joined by dashes) and opens its
    editor. Asked with `Accept: application/json` it answers 201 `{ id }`, or 400 `{ message }`.
  - **Views** (`docs/design/magnetic-show-views.md`). The selector (a menu below 760px) switches the canvas, and the
    view is kept per app in the browser. **Screens** is the canvas of screens. Its rail's **Layers** draw on every
    tile:
    - **Layout:** the named sections, from the frame's real boxes or a schematic.
    - **Data:** the state paths the screen reads and writes, and its outside data.
    - **Logic:** its handlers, the units touching its paths (Server or Browser), and arrows to the screens it leads to.

    **Statenet**, **Theme** and **Logic** each have their tools in a head and an editor at the side:
    - **Statenet:** the owner's tree by state path (`$.apps`, `$.themes`, `$.data`, `$.models`, `$.logic`,
      `$.components`, `$.patterns`, `$.connections`, `$.functions`, `$.personas` with only your own persona), every part with what this app does not use dimmed and one level
      below each. It is a page of Magnetic's (`magnetic-statenet`, a canvas that pans and zooms around a tree of
      cards) shown over the board in place of the screens; the editor's zoom and Fit drive its canvas, and its view is
      kept per app. A + on each branch
      makes what it holds (an app, a screen, a binding, a theme, a dataset, a model, a module or one of its units) and
      puts it to use in the app. Each card opens an editor at the side, and the canvas moves
      the card clear of it: records, model fields, running state and connections (for managers); the app's and a
      component's screens; a theme's default and removal; the way to the Theme or Logic view and back. Removing
      anything asks first.
      Functions are hard IP: `$.functions.<group>.<name>` and a library component's `$.components.<component>.functions.<name>`,
      each a card with its kind and where it runs, no + and no editor; its panel shows its summary and schemas, and a
      unit links to the function it runs.
    - **Theme:** a page of Magnetic's on the board (`magnetic-theme`): a specimen per mode and a table of tokens whose value
      for all modes and in each mode is edited in place. A theme other apps use is read-only until Edit for all or Clone
      for this app.
    - **Logic:** a page of Magnetic's on the board (`magnetic-logic`): unit cards in a Server lane and a Browser lane,
      dragged or moved with their buttons between them, deleted from the card and opened in the side panel, plus the
      screens' handlers.

    The routes are `/edit/<appId>/views/<name>` (`src/server/viewRoutes.ts`), each through the person's own tools.
    Each turn carries the view's part of the app (`ui_get` of the theme, `ui_state_get` on `$.data`, `ui_tree`
    with `logic`, `ui_list` of screens with the layers that are on) as a `<context>` block.
  - The activity drawer, at the foot of the chat, opens the chat and itself when a turn starts. It shows the model's progress notes and one line per tool call
    with its outcome, and has Stop and "Keep open". It closes 4 s after the turn ends, unless the pointer or the
    focus is in it, or it is kept open.
  - The page reads `GET /edit/<appId>/events` (server-sent events: `state` with the chat so far, `person`,
    `say`, `note`, `tool`, `toolDone` and `done`). It posts `/edit/<appId>/turns` (`{ text, context }`) and
    `/edit/<appId>/stop`. A stream holds the workspace open and closes when the session signs out.
  - **The model menu** in the chat bar offers the models of `--models` (default Haiku 5.5, Sonnet 5.5 and Opus 5.5, the
    cheapest first). The browser remembers the pick, and each turn posts it as `model`. A model not offered is
    refused with 400. A turn that names none runs on `--model` (default `claude-haiku-5-5`).
- **The agent** (`AgentTurns`) runs on the server, over the user's own stateui-mcp tools (`createStateUiTools`).
  - One turn at a time per user. A turn is a fresh conversation with the Claude API: the earlier chat goes in as
    text, so no thinking has to be carried across turns.
  - The system prompt is Magnetic's instructions plus stateui-mcp's guide (`buildServerInstructions`), cached, with
    the tools.
  - Requests stream, with adaptive thinking (`display: "updates"` for the progress notes), the effort set by
    `--effort`, `eager_input_streaming` on each tool, and `fallbacks: "default"` on Opus 5.5 and Sonnet 5.5, so a
    request the model declines is retried on the fallback model.
  - A turn ends when the model answers without a tool call, after 40 tool calls, after 5 minutes, on a refusal, or
    on Stop.
  - The browser tools (`ui_preview`, `ui_screenshot`, `ui_interact`) are withheld until the headless browser
    can reach a signed-in page, and so are the answer tools, as no logic waits for an agent here.
  - Each chat is kept in `chat_entry`, every entry; a turn reads the last 100.
- **Budgets** (`Budgets`, a ledger of requests in `agent_request`). Each request is priced from its token counts. A user may spend
  `--daily-budget` dollars per UTC day (default 1; `off` for none), `--user-allowance` dollars ever (a one-time
  allowance such as the beta's $5; default none), and the server `--monthly-budget` per UTC month (default 100).
  `--allowance-users` gives the allowance only to the first people to sign in; the others start with none and may
  buy agent use. With `--beta-org <slug>` (`docs/design/magnetic-beta.md`) it goes instead to the first members of
  that org, who join through the beta link an admin hands out (`/beta/<code>`, on Admin); those after are told the beta
  is full. The host runs the beta: org `beta`, 100 places of $5, $500 a month.
  A turn ends as soon as a request spends the last of any budget, so a limit is passed by one request at most;
  the next turn is refused with a message.
- **Feedback** (`docs/design/magnetic-feedback.md`). The bug button at the top right of the editor sends a bug, a
  comment or a feature request, with the app's name, the frame size and the browser. It is kept in `feedback` and,
  with a mailer and a privacy contact, emailed to that contact with the sender as Reply-To. Twenty an hour per
  person. `magnetic feedback` prints the latest hundred.
- **Admin** (`docs/design/magnetic-admin.md`), `/admin`, for the people whose verified email is in
  `MAGNETIC_ADMIN_EMAILS` (comma-separated); everyone else gets a 404. Admin shows on their Your apps. Overview: people,
  agent use today and this month against the budget, paid, given, open feedback, and the free places left. Feedback:
  open, done or all, by kind, with the sender's email to reply to; Done and Reopen. People: in sign-in order, with
  what each got free, paid, was given, used and has left, and a form to give agent use (up to $500 at a time, kept in
  `agent_credit` as a gift, shown to the person as Given by Magnetic). English only.
- **Editable pages** (`docs/design/magnetic-editable.md`). Sign-in, the share-link page, Your apps and the editor are
  StateUI apps. On **Pages** (`/admin/pages`) an admin edits a draft of each in the editor and publishes it to every
  visitor and to everyone who has not changed their own copy; a draft that does not validate, or no longer raises an
  emit the page needs, is refused with the reasons. Reset serves Magnetic's own again. `?page=default` always shows
  Magnetic's own sign-in or link page, and a published one that does not load falls back to it. Each person can edit
  and reset their own Your apps and editor from "Your pages" on Your apps.
- **Buying agent use after the allowance** (`docs/design/magnetic-payments.md`). With `MAGNETIC_STRIPE_SECRET_KEY`
  and `MAGNETIC_STRIPE_WEBHOOK_SECRET`, a person adds agent use on **Agent use** (`/settings/billing`) through
  Stripe Checkout, in the amounts of `--top-ups` (default $10, $25, $50). Each dollar adds a dollar, spent at the
  model prices.
  - The webhook `<origin>/billing/stripe` (events `checkout.session.completed`,
    `checkout.session.async_payment_succeeded`, `charge.refunded`) is the only thing that adds credit. It checks
    Stripe's signature and keeps a ledger, `agent_credit`, where the same news twice adds nothing.
  - While a person spends what they bought, the daily limit and the server's monthly budget do not stop them; an
    org's monthly budget still does.
  - Without the keys, the page shows the balance and says buying is not available.

- **Sharing** (`Grants`, `link_grant` and `link_grant_member`). The editor's Share panel makes links to the app:
  - `use` (the default): each person who opens it gets their own instance of the app, with their own data
    (persona = their user id);
  - `view`: the owner's instance, live and read only. Changes are rejected and file uploads refused;
  - `remix`: a copy of the app, and the parts it reaches, in the person's own workspace, theirs to change. No data
    or uploaded files are copied.

  A link is `/s/<token>`, with a random 32-character token, and needs a signed-in person. The home page lists the
  apps shared with the person. **Revoke** closes the open views of everyone who opened the link and tells their
  browsers to delete what they kept of the app. A browser that was away is told on its next visit or connection.
  Copies made by remixing are not touched. The starter apps cannot be shared, as every workspace has them under the
  same id.

## Orgs

An org is a company: its members have one role each, its apps live in the org's workspace, and each app has an access
list (`src/orgs/`, `docs/design/magnetic-postgres.md`).

| Role | Can |
|---|---|
| `owner` | Everything, including changing owners; an org always keeps one |
| `admin` | Members, groups, invites, access lists, the audit log; manages every app |
| `builder` | Makes apps in the org, moves apps of their own into it, and edits the apps their access allows |
| `member` | Uses the apps their access allows |

An app's permission for a person is the highest of their own entry and their groups' entries on its access list
(`manage`, `edit`, `use`, `view`), or `use` when the app is open to the org; owners, admins and whoever made the app
manage it. Each member has their own instance of an org app (persona = their user id): their route, form values and
the records of its persona bindings are theirs, and its datasets are shared. Only `edit` and up open the editor and the
agent, and only `manage` shares it. Losing an app, or leaving the org, closes its open views at once.

Moving an app of one's own into an org (`POST /apps/<id>/move`) keeps its id, so its address and links still work; its
instances, persona records, files, chat and links go with it in one transaction, and the parts it reaches are copied
(the person's own workspace keeps its copies). The org's apps show on Your apps beside the apps shared with the person.

People manage their orgs at `/settings/orgs` (the **Orgs** button on Your apps): make an org, and on its page see the
members, groups and apps and, as far as their role goes, change roles, make groups, invite people (the link is shown
once), make an app in the org or bring one of their own in, give apps to people and groups, open them to the org, see
who uses each app, and read the audit log. An invite link (`/invites/<token>`) opens a page that joins the org. Org
admins can open a member's state of an app read only, for support; each look is written to the audit log.

The agent changes an app for one person at a time: while one person's turn works on an org app, another person's turn
on it is refused until it ends.

The same is there as JSON routes:

| Route | What |
|---|---|
| `GET`, `POST /orgs` | Your orgs; make one (`{ name, slug }`) |
| `GET /orgs/<id>/members`, `POST`, `DELETE /orgs/<id>/members/<userId>` | Members; change a role (`{ role }`); remove |
| `GET`, `POST /orgs/<id>/groups`, `POST`, `DELETE /orgs/<id>/groups/<groupId>/members/<userId>` | Groups and their members |
| `POST /orgs/<id>/invites` | Invite an email (`{ email, role, groups }`); answers the link |
| `POST /invites/<token>/accept` | Accept, signed in with the verified email invited, within 7 days |
| `GET`, `POST /orgs/<id>/apps` | The org's apps you may open; make one (`{ name }`, builders) |
| `GET`, `POST /orgs/<id>/apps/<appId>/access` | The access list; set or remove an entry (`{ principalKind, principalId, permission }`) |
| `POST /orgs/<id>/apps/<appId>/open` | Open the app to every member, or close it (`{ open }`) |
| `GET /orgs/<id>/audit` | The audit log, newest first (admins) |
| `GET /orgs/<id>/apps/<appId>/instances` | Who uses the app, last used first (people who manage it) |
| `GET /orgs/<id>/apps/<appId>/instances/<userId>` | A member's state as last saved, read only (admins; audited) |
| `POST /apps/<id>/move` | Move an app of your own into an org (`{ orgId }`) |
| `GET`, `POST /orgs/<id>/policy` | The org's policies; change some (`{ externalLinks: true, retentionDays: null, … }`, admins; `requireSso` owners) |
| `GET`, `POST /orgs/<id>/domains` | The org's domains with their TXT records (admins); claim one (`{ domain }`, owners) |
| `POST /orgs/<id>/domains/<domain>/verify`, `DELETE /orgs/<id>/domains/<domain>` | Look the TXT record up; give the domain up (owners) |
| `GET`, `POST /orgs/<id>/sso` | The org's own provider and its redirect URI (admins); set it (`{ issuer, clientId, clientSecret, enabled }`, owners) |
| `GET /orgs/<id>/spend` | This month's agent spend in the org's apps, by person and app (admins) |
| `GET /orgs/<id>/export` | Everything the org holds, as a JSON download (owners) |
| `DELETE /orgs/<id>` | Delete the org and its workspace (`{ confirm: <slug> }`, owners) |

### Enterprise controls

- **Verified domains.** An owner claims an email domain and publishes the TXT record it is given at
  `_magnetic-challenge.<domain>`; only a verified domain routes sign-in to the org or lets people join by it.
- **The org's own sign-in.** An owner sets the org's OpenID Connect provider (Okta, Entra ID, Google Workspace) with
  the redirect URI `<origin>/auth/sso/callback`. People type their work email on the sign-in page and go to their org's
  provider. Its client secret is sealed with `MAGNETIC_SECRET_KEY`; a server without one offers no org sign-in. An org's
  provider vouches only for emails at that org's verified domains.
- **Policies.** `requireSso` (people at the org's domains sign in only through its provider), `autoJoin` (people at its
  domains with a verified email, or signed in through its provider, join as members), `externalLinks` (share links to
  its apps open for people outside it; off by default), `personalWorkspaces` (off: its members cannot make apps of
  their own), `agentModels` (the models its apps' turns may use), `retentionDays` (old chats, and the state of people
  who left, are deleted hourly), and `monthlyBudget` (dollars per month for the agent in its apps).
- **The audit log** records sign-ins, membership, roles, groups, invites, access, links, policies, domains, sign-in
  settings, apps and support views. It is append only: the database refuses to change or delete an event.
- **Export and deletion.** An owner downloads everything the org holds as JSON, and deletes the org by typing its short
  name.

## Grants of state

People can share part of their own state with someone else, read or write, and see and revoke everything shared
(`docs/design/statenet-relays.md`, S4). It needs `MAGNETIC_SECRET_KEY`, which keeps every owner's signing key.

- Every owner (a user, or a workspace) has an Ed25519 key, made the first time it signs, its private part sealed with
  the server's key. `POST /keys/rotate` (and `POST /orgs/<id>/keys/rotate` for an org's owners) makes a new one; the
  old one still verifies the grants it signed until they expire.
- `POST /grants` `{ subject, address, prefix, rights, lifeMs?, parentId? }` shares part of your state (an address is
  `<owner>/<app>/user`), or passes on part of a grant you hold, never wider. `POST /grants/<id>/token` signs a fresh
  token, which lives four hours; `POST /grants/<id>/revoke` revokes a grant and everything passed on from it.
- **Shared by me** (`/settings/shared`, `GET /grants`) lists every grant on your state and every grant you gave, with
  when it was last used and Revoke.
- An org reads its members' state in its apps through a standing grant (made the first time it reads, revoked when
  they leave); the support view reads through it and writes the grant's id to the audit log. With the policy
  `grantsInOrg`, members' state in the org's apps can be shared only with people in the org.

## Several servers

Any number of Magnetic servers can share one database (`docs/design/statenet-relays.md`, "Topology, in steps", 2
and 3). Each runs as a node of the statenet with `--mesh-port` (and `MAGNETIC_SECRET_KEY`, which keeps the statenet's
certificate authority):

```bash
magnetic --mesh-port 4310 --mesh-url ws://magnetic-2:4310 --node-id magnetic-2
```

- **One server runs each instance.** A person's state of an app (`<person>/<app>/user`) is owned by one server at a
  time, under an epoch, and its saves carry the epoch, so a server that lost it can no longer save it. The server
  that is first asked for it takes it; the agent's tools move it to their server; and ownership moves to a server
  that sends most of its writes. A server that stops lets its instances go at once, and those of a server that is
  lost are taken over when their leases run out (10 seconds).
- **A view anywhere.** A view's socket at a server that doesn't run the instance gets a session tunnelled to the
  server that does, over the mesh, with its writes and events both ways. When the instance moves or restarts, the
  view connects again.
- **Part changes reach every server** on Postgres's `stateui_part` channel, so views, the usage index, shared datasets
  and running instances catch up with a change another server made.
- **Relays.** `magnetic relay-certificate --node-id relay-1 --out certs` writes a key and a node certificate for a
  `statenet-relay`, which links to the servers' mesh and serves subscriptions without reaching the database.

`docker compose -f docker/statenet.compose.yml up --build` (from the workspace root) runs two servers, Postgres and a
relay.

## Semantic search

Magnetic embeds every part when it changes and every chat entry when it is written, and searches them by meaning
(`docs/design/magnetic-postgres.md`, "Every stored vector names its model"). A write never waits: it queues a job in
its own transaction, and a worker in the server embeds the queue every 2 seconds. Every vector is stored with the model
that made it, and a search compares only that model's vectors, through the model's own HNSW index.

- `GET /search?q=...` finds the apps a person may open, in their own workspace and their orgs', best first.
- The agent gets `parts_search` (the parts of the workspace closest to a need, to reuse one) and `chat_recall` (the
  person's own earlier chats in the workspace, about any app).
- `ui_components_search` and `ui_patterns_search` rank the component library by meaning when their keywords come back
  weak, and merge the two lists by reciprocal rank; a hit found that way says `byMeaning: true`, and the result is weak
  only when the closest meaning is not close. The library is embedded once per catalog version and model
  (`catalog_embedding`), for every workspace and every server on the database.
- A model's string field marked `embed: true` makes that field of every record searchable, in datasets and persona
  bindings; a record edit queues only that record and field, and a model that starts or stops embedding a field queues
  its records. An app's logic asks with `call` (target `similar`, value `{ binding, field, text, limit? }`) and gets
  `{ results: [{ key, score }] }`; over a persona binding, only the records of the person whose instance asks. The
  agent gets `data_similar` for the same search.

`--embedding local` (the default) runs all-MiniLM-L6-v2 on the CPU through ONNX Runtime: no key, and no text leaves
the server. It needs `@huggingface/transformers` (`npm install @huggingface/transformers -w @punyts/magnetic`); the
model, about 90 MB, is downloaded into `--model-cache` on first use, so bake it into a hosted image. Without the
package the server says so and runs without semantic search; it never stores vectors under another model.
`--embedding hash` hashes words instead (no model, for development and tests), and `off` turns it off. After changing
the embedding, `magnetic reindex` embeds everything again with the new model; run it as the database's owner, as it
reads every workspace.

## Use it from code

```ts
import { startMagnetic } from '@punyts/magnetic';

const magnetic = await startMagnetic({ database: createDatabase({ url }), host: '127.0.0.1', port: 4300, report: console, devUsers: ['alice'] });
console.log(magnetic.origin);
await magnetic.stop();
```

`startMagnetic` returns `{ origin, port, runtimePort, accounts, sessions, workspaces, signIn, turns, budgets, grants, stop }`.
The options also take:
- `providers`, such as `[linkedInProvider(id, secret)]`;
- `publicOrigin`;
- `allowHttpProviders`, for a mock provider on loopback;
- `starter`, `runtimeDir` and `chunk3dDir`;
- `browser`, a stand-in headless browser for tests;
- `logicLimits`, `socketMessagesPerSecond` and `workspaces` (`idleMs`, `max`);
- `secureCookies`;
- `agent`: `model` (an `AgentModel`, such as a scripted one in tests; default `ClaudeModel`), `modelName`
  (default `claude-haiku-5-5`), `models` (the ids people may pick; default `AGENT_MODELS`), `effort` (default
  `high`), `budgets` and `limits`.

`startMockOidcProvider()` starts the mock provider the tests use, and `MockAgentModel` is the scripted agent of
`--mock-agent`.

## Not yet

- **The agent cannot see the page.** The browser tools are withheld: each workspace would open its own Chromium,
  and its headless page cannot sign in to reach the app. One shared browser with a context per user, and a way for
  it to sign in, come before the agent gets them back.
- **Sharing leaves some things behind.**
  - Deleting an app does not delete the instances of the people it was shared with, nor its links.
  - A person who moves from a `use` link to a `view` link keeps their `use` data in their browser.
  - The page of a revoked app still shows its name.

## Develop

```bash
npm run build
npm test        # needs the database: npm run magnetic:db, or PUNYTS_TEST_DATABASE_URL. Each test file gets a schema of its own. vitest: accounts, sessions, workspaces, the options, budgets, grants, provider sign-in against the mock provider, agent turns against recorded answers, sharing and revoking, and the server over HTTP and WebSockets
npm run e2e     # builds, then the Playwright suite: the whole UI as a person uses it, at desktop and phone sizes
npm run e2e:report   # the last run's report, with a trace and a screenshot of each failure
```

**On GitHub** (`.github/workflows/ci.yml`) the typecheck, the unit tests and the Playwright suite run on every push and pull request to `develop` and `main`, and nightly. The job checks out the workspace, puts this repo at `magnetic/`, clones the other libraries' `develop`, builds as the production image does (Node 22), and runs against a pgvector Postgres service on port 5433. Each run keeps the Playwright report and any failures' traces for 14 days.

**The Playwright suite** (`e2e/`, `playwright.config.ts`) starts its own server, `e2e/server.mjs`:
- Magnetic from `dist` on a fresh schema of the test database, dropped when the run ends;
- the dev users alice to gina (erin is the admin once the control port gives her a verified email), the mock OIDC
  provider, and the scripted agent, so no test needs an API key or LinkedIn;
- the beta's budget ($5 per person);
- a control port (the page port + 2) that sets who the mock provider signs in next, so a test can sign in as a
  person with a verified email.

`e2e/fixtures.ts` has a page object per page. Magnetic's own pages are StateUI apps in frames from the runtime
origin, and the page objects find them:
- the sign-in page's frame is in `#page-app`;
- Your apps' frame is in `body.home`;
- the editor is `#editor iframe`, with the person's app on the canvas at `#artboard iframe`;
- an app opened on its own, as a person given it sees it, has only one frame.

The org settings, Shared by me, Data, Agent use and privacy pages are plain HTML.

| Spec | Covers |
|---|---|
| `signin.spec.ts` | The sign-in choices; a dev user and a provider sign-in landing on Your apps; back to the page asked for; sign out; the privacy page without a session |
| `home.spec.ts` | Making an app (and the name it needs); its card opening it; Orgs; appearance and language kept across a reload |
| `editor.spec.ts` | The bars and tools; the ideas of a blank app; a turn of the agent and the chat; frame sizes; zoom and fit; selecting a part, its properties, and editing its text by hand; Ctrl+Shift+E; going home. The library: shown and hidden (button, `A`, phone), narrowed by letter and category, a component pressed then placed, dragged and dropped onto the app, and dropped outside it. Layout and placement: a column made a grid, a part spanning two columns, a setting kept across types |
| `screens.spec.ts` | (Desktop only) The Screens panel and a frame per screen in order; pressing a preview to work on it in its place; copy, rename, open-on and delete; a bad name refused; previews out of view not running |
| `connections.spec.ts` | The Connections page from Your apps; a key connection made, its endpoint added and tried, with the key never on the page; a URL that is not https refused; an OAuth connection connected through the stand-in provider (port + 3) and called with its token; deleting only with the box ticked; the page in German for someone who chose no language; the editor's Connections panel listing an endpoint and asking the agent, with "Yours" in the top bar; an org with connections turned off: its page says so with no Try, and its app's editor names the org and says so too |
| `feedback.spec.ts` | The editor's bug button: a feature request sent and emailed to the operator with the frame size, the box cleared; an empty one refused, and the sheet closed by its button |
| `admin.spec.ts` | No Admin on Your apps for someone who is not one; an admin (a verified email listed in `admins`) reading a bug sent from the editor, marking it done and opening it again, and giving another person $3 of agent use |
| `pages.spec.ts` | (Publish at desktop only) An admin editing sign-in, publishing it, a stranger seeing it and Magnetic's own at `?page=default`, a draft without the development sign-in refused, and Reset; a person editing Your apps, keeping the change in German, and resetting it |
| `data.spec.ts` | The Data page from Your apps; a dataset shared by email, listed under Shared with this workspace for the other person with the `uses.external` that reads it, then stopped and gone from their page; the editor's Shared data panel listing a dataset shared with the workspace and asking the agent; an email nobody has refused with the reason |
| `billing.spec.ts` | The Agent use page from Your apps; $10 bought through the stand-in Stripe's checkout page (the API port) and its signed webhook, then refunded; a cancelled checkout charging nothing |
| `share.spec.ts` | What each right means; a `use` link opened by another person, on their Your apps, then revoked; a remix becoming the other person's copy |
| `orgs.spec.ts` | Making an org; a group; an invite accepted by the person with that verified email, with its role; an invite refused for another email; an app made in the org. Invites emailed (the test server's memory mailer, `GET /mail` on the control port), joined and declined from Your apps; orgs listed there |

The server can be started on its own for a look around, as the `magnetic-e2e` launch configuration does:
`node e2e/server.mjs` serves http://127.0.0.1:4390.
