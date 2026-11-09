# Changelog

## 0.1.0 (unreleased)

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
