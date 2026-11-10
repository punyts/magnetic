# Changelog

## 0.1.0 (unreleased)

- **M3, the editor and the agent.**
  - `/edit/<appId>` shows the live app beside a chat. `POST /new` makes an app and opens it there.
  - The chat box has the context toggles Theme, Layout, Data, Logic and Screens. Each adds what a read-only tool
    says about that part of the app to the turn.
  - `AgentTurns` runs the agent on the server over the user's own stateui-mcp tools, one turn at a time per user,
    streaming what it says and does to the page (server-sent events). The browser and answer tools are withheld.
  - The activity drawer lists each tool call, has Stop and "Keep open", and closes 4 s after the turn.
  - `ClaudeModel` calls the Claude API (`@anthropic-ai/sdk`): streaming, adaptive thinking with progress notes,
    cached system prompt and tools, eager tool input streaming, and the server-side fallback on a refusal. The
    model is `--model` (default `claude-opus-5-5`) at `--effort` (default `high`).
  - `Budgets` prices each request and refuses a turn once the user's daily budget (`--daily-budget`, default $1)
    or the server's monthly budget (`--monthly-budget`, default $100) is spent.
  - Each app's chat is kept and comes back when the editor is opened again.
  - `--mock-agent` (loopback only) plays a scripted agent, to try the editor without an API key.
  - Tests: `src/server/agentRoutes.test.ts` (a turn against recorded answers writes nodes; stop; the tool-call
    limit; a refusal; a spent budget; the earlier chat), `src/agent/Budgets.test.ts`, and the new options.
- **M2, LinkedIn sign-in.**
  - `OidcSignIn` signs people in with OpenID Connect providers through `openid-client`, using the authorization code
    flow with state, nonce and PKCE. The ID token's signature is checked against the provider's keys.
  - `linkedInProvider` is LinkedIn's preset, set with `MAGNETIC_LINKEDIN_CLIENT_ID` and
    `MAGNETIC_LINKEDIN_CLIENT_SECRET`.
  - A sign-in in flight is bound to its browser by the cookie `magnetic_signin`, and its callback is accepted once.
  - **Back to where they were:** a page request without a session goes to `/signin?next=<path>`, and signing in
    returns there.
  - `--public-origin` sets the redirect URIs. Cookies are `Secure` when the public origin is HTTPS.
  - `--mock-provider` runs a mock provider beside the server, on loopback only. `npm run magnetic` turns it on.

- **M1, the multi-user server.**
  - `startMagnetic` and the `magnetic` CLI embed the stateui-mcp browser endpoint with one workspace per signed-in
    user (`Workspaces`). Each workspace has its own folder and owner id, opens on first use, and closes when it has
    been idle with no view or when too many are open.
  - **Development sign-in:** `--dev-user`, on loopback hosts only.
  - **Users and identities:** `Accounts`, in `accounts.json`.
  - **Sessions:** `Sessions`, keeping only the hashes of the tokens, for 30 days. Signing out closes that
    session's sockets.
  - **Without a session:** a page goes to `/signin`, and anything else gets 401.
  - **Logic limits:** a `call` or effect with no function fails, and more than 20 timers in one second stop an
    instance's logic.
  - **Socket rate limit:** 50 frames a second per view socket.
  - **Starter app:** a new workspace gets the component showcase.
  - **Pages:** Magnetic's own pages send `Referrer-Policy: same-origin`, so their forms post with an `Origin`.
