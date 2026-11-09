# Changelog

## 0.1.0 (unreleased)

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
