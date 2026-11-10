# Changelog

## 0.1.0 (unreleased)

- **The app is a frame on a canvas.** Instead of padding the app clear of the floating panels, the app sits in a
  frame (Desktop, Tablet or Phone) on a board that pans and zooms: scroll or drag the board to pan, Ctrl+scroll
  or pinch to zoom, the Move tool or Space to pan over the app, and a zoom control with Fit and 100%. The view
  is kept per app in the browser.
- **The editor floats on the app.** The app fills the page, and the editor sits on it in rounded panels: the name
  at the top left, Share at the top right, the context toggles on a rail at the left and a chat bar at the bottom
  centre. The chat opens above the bar when it is focused or a turn starts, and closes with its button or Escape.
  Enter now sends (Shift+Enter for a new line), and the bar grows with the request. Before, the chat was a
  column at the right.
- **The agent builds instead of reading.** Its instructions now say that the app already exists (no
  `ui_app_create`), that the check is `ui_validate` only, and how behavior works (links write back, a button runs
  only set, toggle, emit and navigate, so saving a record is a rule). They give a short path for a new app and a
  worked to-do example, checked in a browser, written as shallow section writes. On Haiku 5.5 a to-do list, a reading
  list and a tip calculator now build in 12 to 20 tool calls for under 1.5 cents each; before, a to-do list spent 40
  calls and built nothing.
- **A tool input that is not JSON is retried.** The SDK reports it as its own error, which was not caught, so the turn
  failed. It is now retried twice, with a note asking for shallower inputs.
- **"No valid API key" only for a missing key.** The message was given for any error whose text held "auth", such as
  a tool input with an "author" field.
- **A model per turn.** The editor has a model menu beside Send: Haiku 5.5, Sonnet 5.5 and Opus 5.5 by default
  (`--models`, `MAGNETIC_MODELS`, `agent.models`; `AGENT_MODELS`). The browser remembers the pick and each turn
  posts it; a model not offered is refused with 400. The default model is now `claude-haiku-5-5`, as every turn is
  paid for.
- **Budgets hold mid-turn.** A turn ends as soon as a request spends the last of the user's daily or the server's
  monthly budget, so a hard limit is passed by one request at most. Before, the turn that crossed it ran to its end.
- **A logo**, in `brand/` (SVG, and PNGs at 512, 300 and 100 pixels).
- Tests: a turn on the picked model, the menu in the editor, a model not offered, a turn ended by the budget, and
  `--models`.
- **M6, sharing.**
  - The editor's **Share** panel makes links to an app: `use` (the default: the person gets their own instance of
    the app, with their own data), `view` (the owner's instance, live and read only) and `remix` (a copy of the app
    in the person's own workspace). It lists the links with how many people opened each, and has Copy and Revoke.
  - `Grants` keeps the links in `grants.json`, each with a random 32-character token and the people who opened it.
    Every link needs a signed-in person.
  - `GET /s/<token>` opens a link: `use` and `view` go to `/apps/<appId>`, and `remix` shows a page with a Remix
    button (`POST /s/<token>/remix`), which copies the app and the parts it reaches and opens the copy's editor.
  - The home page lists the apps shared with the person under "Shared with you".
  - **Revoke** closes the open views of everyone who opened the link and tells their browsers, which delete what
    they kept of the app. A browser that was away is told on its next visit or connection. A remix is a copy and
    keeps working.
  - The starter apps (the showcase) cannot be shared: they have the same id in every workspace.
  - Tests: `src/sharing/Grants.test.ts` and `src/server/sharing.test.ts` (a `use` link gives the person their own
    instance; a `view` link rejects changes and file uploads; revoke closes the socket with the `revoked` error;
    a browser that was away is scrubbed; a remix works after the revoke; another owner cannot revoke).
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
