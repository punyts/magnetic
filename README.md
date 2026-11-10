# @punyts/magnetic

Magnetic is an AI app builder on StateUI. People sign in, describe an app, and watch an agent build it as a live
StateUI app. They can look at its state, edit it by hand, and share it. The design is in
`docs/design/magnetic-v1.md` in the workspace.

Built so far: the multi-user server (M1), sign-in through LinkedIn or any OpenID Connect provider (M2), the editor
and the agent (M3), and sharing (M6). Each person gets a workspace of their own, and their apps run live behind their
session. Hosting (M7), the state view (M4) and the hand editor (M5) come next.

The logo is in `brand/`: `logo.svg`, and PNGs at 512, 300 and 100 pixels.

## Run it

From the workspace:

```bash
npm run magnetic:build   # the libraries Magnetic uses, Magnetic itself and the runtime bundle
npm run magnetic         # http://127.0.0.1:4300/, with the development users alice and bob, a mock provider and the mock agent
```

`npm run magnetic` runs the scripted mock agent, so the editor works without an API key and costs nothing. To use
Claude, set `ANTHROPIC_API_KEY` and start the server without `--mock-agent`:

```bash
npm run start -w @punyts/magnetic -- --dev-user alice
```

Open it at `http://127.0.0.1:4300/`, not `localhost`: the provider sends the browser back to the origin the server
listens on, and a cookie set on one host is not sent to the other.

### Sign in with LinkedIn

1. Make an app at the LinkedIn developer portal and add the product "Sign In with LinkedIn using OpenID Connect".
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
node dist/cli.js --data-dir ./data --dev-user alice --dev-user bob
```

| Option | Environment | Default | What |
|---|---|---|---|
| `--data-dir <dir>` | `MAGNETIC_DATA_DIR` | `./data` | Where the accounts, sessions and workspaces live |
| `--port <n>` | `MAGNETIC_PORT` | `4300` | Port of the pages and sockets |
| `--runtime-port <n>` | `MAGNETIC_RUNTIME_PORT` | the next port | Port of the runtime origin, which serves only the app frame |
| `--host <address>` | `MAGNETIC_HOST` | `127.0.0.1` | Address to bind |
| `--dev-user <name>` | `MAGNETIC_DEV_USERS` (comma-separated) | none | A test user who signs in with a button and no provider; repeat for more. Loopback hosts only |
| `--starter <kind>` | `MAGNETIC_STARTER` | `showcase` | What a new workspace holds: the component showcase, or `none` |
| `--runtime-dir <dir>` | `MAGNETIC_RUNTIME_DIR` | the bundle in `@punyts/stateui-app` | The built StateUI runtime bundle |
| `--public-origin <url>` | `MAGNETIC_PUBLIC_ORIGIN` | the address it listens on | The origin people reach the server at. Redirect URIs are `<origin>/auth/<provider>/callback`, and cookies are `Secure` when it is HTTPS |
| `--mock-provider` | `MAGNETIC_MOCK_PROVIDER=true` | off | Also runs a mock OpenID Connect provider that signs anyone in as a test person. Loopback hosts only |
| | `MAGNETIC_LINKEDIN_CLIENT_ID`, `MAGNETIC_LINKEDIN_CLIENT_SECRET` | none | LinkedIn's client. Environment only, so the secret stays out of the process list |
| | `MAGNETIC_LINKEDIN_PKCE` | `true` | `false` sends no PKCE challenge to LinkedIn |

## How it works

- **The server is stateui-mcp's browser endpoint.** `startMagnetic` runs `startHttpServer` of `@punyts/stateui-mcp`
  with a `tenant` function. It serves the app pages, the runtime origin, the view sockets in Full mode, uploads and
  reports, and adds Magnetic's own routes: `/signin`, `/signin/dev`, `/signout`, `/` and `/assets/magnetic.css`.
  There is no `/mcp`: the agent will run in the server.
- **One workspace per user.** Each signed-in user gets their own stateui-mcp `Services`. These are over their own
  folder, `data/users/<userId>`, with their user id as the owner (`Workspaces`). One user's parts, instances, files
  and live authorities never meet another's: an app id of another user is not found, by page, route or socket.
  - A workspace opens on the user's first request.
  - Any workspace that has had no open view socket and no request for 10 minutes is closed.
  - Past 200 open workspaces, the least recently used ones without sockets are closed.
  - A new workspace starts with the component showcase, unless `--starter none`.
- **Users and identities.** `data/accounts.json` maps each sign-in identity (`<provider>:<subject>`) to a user id, a
  UUID, and keeps the user's name, email and picture. The user id owns everything. A second provider can later point
  at the same user.
- **Sessions.**
  - The cookie `magnetic_session` holds a token of 32 random bytes. It is `HttpOnly`, `SameSite=Lax` and
    `Path=/`, and `Secure` with `secureCookies`.
  - `data/sessions.json` keeps the token's SHA-256 hash, not the token, so the file alone opens no session.
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
  834×1112, Phone 390×844) and Open; at the top right, Share, whose links open in a panel under it; on a rail at
  the left, the tools and the context toggles; at the bottom right, the zoom.
  - **The canvas** pans and zooms. Scrolling on the board pans it, Ctrl+scroll or a pinch zooms about the
    pointer, and dragging the board pans it. Over the app, the app gets the pointer as usual; with the Move tool
    (H) or Space held, a cover lies over the frame and the pointer moves the board. V goes back to Use; +, - and
    0 zoom in, out and to 100%; 1 fits the frame in the free space, never past 100%. The zoom control does the
    same. The view and the frame size are kept per app in the browser; a new app opens fitted, in the phone
    frame on a narrow screen.
  - At the bottom centre is a chat bar: the request, the model menu and Send. Focusing it, or its chat button,
    opens the chat above it; the close button or Escape closes it. Enter sends and Shift+Enter starts a new line.
    On a phone the rail sits in a row under the top bar.
  - The page carries the same body attributes as stateui-mcp's `/apps/<appId>`, so the host script builds the live
    app frame. Every change the agent writes shows in it at once. It sends the host page's policy
    (`hostPageCsp`).
  - `POST /new` makes an app from the name typed on Your apps (lower case words joined by dashes) and opens its
    editor. Asked with `Accept: application/json` it answers 201 `{ id }`, or 400 `{ message }`.
  - The rail has five toggles, Theme, Layout, Data, Logic and Screens. Each adds what a read-only tool says about
    that part of the app (`ui_get`, `ui_tree`, `ui_tree` with `logic`, `ui_state_get` on `$.data`,
    `ui_list` of screens) to the turn as a `<context>` block.
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
  - Each chat is kept in `users/<userId>/magnetic/chats/<appId>.json` (the last 100 entries).
- **Budgets** (`Budgets`, `data/budgets.json`). Each request is priced from its token counts. A user may spend
  `--daily-budget` dollars per UTC day (default 1) and the server `--monthly-budget` per UTC month (default 100).
  A turn ends as soon as a request spends the last of either budget, so a limit is passed by one request at most;
  the next turn is refused with a message.

- **Sharing** (`Grants`, `data/grants.json`). The editor's Share panel makes links to the app:
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

## Use it from code

```ts
import { startMagnetic } from '@punyts/magnetic';

const magnetic = await startMagnetic({ dataDir: './data', host: '127.0.0.1', port: 4300, report: console, devUsers: ['alice'] });
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

- **Hosting** (M7): HTTPS, public host names for the two origins, and the Host check behind a proxy. Until then the
  runtime origin is `http://<host>:<runtime port>`, which suits a local server only.
- **The agent cannot see the page.** The browser tools are withheld: each workspace would open its own Chromium,
  and its headless page cannot sign in to reach the app. One shared browser with a context per user, and a way for
  it to sign in, come before the agent gets them back.
- **Sharing leaves some things behind.**
  - Deleting an app does not delete the instances of the people it was shared with, nor its links.
  - A person who moves from a `use` link to a `view` link keeps their `use` data in their browser.
  - The page of a revoked app still shows its name.
- **The shell is a server page**, not a StateUI app as the design has it. The state view (M4) and the editor overlay
  (M5) will show whether it needs to be one.

## Develop

```bash
npm run build
npm test        # vitest: accounts, sessions, workspaces, the options, budgets, grants, provider sign-in against the mock provider, agent turns against recorded answers, sharing and revoking, and the server over HTTP and WebSockets
```
