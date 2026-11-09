# @punyts/magnetic

Magnetic is an AI app builder on StateUI. People sign in, describe an app, and watch an agent build it as a live
StateUI app. They can look at its state, edit it by hand, and share it. The design is in
`docs/design/magnetic-v1.md` in the workspace.

This is stage M2: the multi-user server (M1), with sign-in through LinkedIn or any OpenID Connect provider. Each person
gets a workspace of their own, and their apps run live behind their session. The shell and the agent (M3), the state
view (M4), the editor (M5) and sharing (M6) come next.

## Run it

From the workspace:

```bash
npm run magnetic:build   # the libraries Magnetic uses, Magnetic itself and the runtime bundle
npm run magnetic         # http://127.0.0.1:4300/, with the development users alice and bob and a mock provider
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

## Use it from code

```ts
import { startMagnetic } from '@punyts/magnetic';

const magnetic = await startMagnetic({ dataDir: './data', host: '127.0.0.1', port: 4300, report: console, devUsers: ['alice'] });
console.log(magnetic.origin);
await magnetic.stop();
```

`startMagnetic` returns `{ origin, port, runtimePort, accounts, sessions, workspaces, signIn, stop }`. The options
also take:
- `providers`, such as `[linkedInProvider(id, secret)]`;
- `publicOrigin`;
- `allowHttpProviders`, for a mock provider on loopback;
- `starter`, `runtimeDir` and `chunk3dDir`;
- `browser`, a stand-in headless browser for tests;
- `logicLimits`, `socketMessagesPerSecond` and `workspaces` (`idleMs`, `max`);
- `secureCookies`.

`startMockOidcProvider()` starts the mock provider the tests use.

## Not yet

- **Hosting** (M7): HTTPS, public host names for the two origins, and the Host check behind a proxy. Until then the
  runtime origin is `http://<host>:<runtime port>`, which suits a local server only.
- **One headless browser per workspace.** Each workspace opens its own Chromium when it first previews. Nothing does
  that in M1. The agent in M3 will share one browser with a context per user, and its headless pages need a way to
  sign in.

## Develop

```bash
npm run build
npm test        # vitest: accounts, sessions, workspaces, the options, provider sign-in against the mock provider, and the server over HTTP and WebSockets
```
