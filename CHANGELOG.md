# Changelog

## 0.1.0 (unreleased)

- **The whole UI under test with Playwright** (M8, N1). `npm run e2e` builds Magnetic and runs `e2e/`: 29 tests at desktop and phone sizes, covering sign-in and sign-out, Your apps, the editor, sharing and orgs, as a person uses them. The suite starts its own server (`e2e/server.mjs`) on a fresh schema with the dev users, the mock provider and the scripted agent, and makes a trace and a screenshot of each failure (`npm run e2e:report`). `npm run typecheck` checks the suite too.
- **A one-time agent allowance per person.** `--user-allowance` (`MAGNETIC_USER_ALLOWANCE`) caps what one person spends on the agent ever, for the beta's $5. `--daily-budget off` drops the daily limit. The server's monthly cap stays. Tests: `Budgets.test.ts`, `options.test.ts`.

- **Servers starting together no longer race to make Magnetic's own apps.** The sign-in and other page apps, the default editor, and each person's editor and home app are made under a Postgres advisory lock (`databaseExclusive`, one key for the system workspace and one per person): a server checks without it, and only when the app looks missing or old takes the lock, reads the parts again past its own index, and makes it if it is still needed. Before, two servers asked for the sign-in page at once both made it and one failed on the other's revision. Tests: `startupRace.test.ts` (fails with 500s without the lock).
- **A privacy page.** With `MAGNETIC_OPERATOR` and `MAGNETIC_CONTACT_EMAIL`, `/privacy` says in plain words, without a sign-in, what Magnetic keeps, why, who else sees it (the people you share with, Anthropic for the assistant, the host), how long, and how to have it deleted. A sign-in provider such as LinkedIn links to it. Tests: `publicOrigins.test.ts`, `options.test.ts`.
- **Behind a proxy, at two public origins** (M7, H1). `--runtime-origin` (`MAGNETIC_RUNTIME_ORIGIN`) beside `--public-origin`: the pages frame the app runtime from that origin, the runtime page lets only the public origin frame it, and the server answers only to those two host names (and loopback). A runtime origin on the public origin's host is refused. `magnetic migrate --app-role <role>` (`MAGNETIC_APP_ROLE`) grants the role the servers connect as the rows of every table, refusing a superuser or `BYPASSRLS` role. `docker/magnetic.compose.yml` in the workspace runs Caddy in front of two servers and a relay. Tests: `publicOrigins.test.ts`, `appRole.test.ts`, `options.test.ts`.
- **Several servers on one database.** `--mesh-port` (`MAGNETIC_MESH_PORT`, with `--mesh-host`, `--mesh-url`, `--node-id` and `--region`; `MagneticOptions.statenet`) runs a server as a node of the statenet: it registers in the directory and heartbeats, signs its own node certificate with the statenet's authority (an `owner_key` of `statenet`, sealed with `MAGNETIC_SECRET_KEY`), owns the instances it is first asked for, tunnels views of the others to their servers, hears other servers' part changes, and lets its instances go when it stops. `statenet_namespace` (migration 0005) names the workspace of each placed address. `magnetic relay-certificate` writes a relay's key, certificate and the authority key. `docker/statenet.compose.yml` in the workspace runs two servers, Postgres and a relay. Tests: `statenet.test.ts`, `options.test.ts`.

- **`npm run start:live`** starts Magnetic with Node reading `../.env` (the workspace root's, which git ignores) when it exists, so the API key for the real agent can live in a file instead of the shell. The workspace's `npm run magnetic:live` uses it with the development users.
- **Take one thing out of the chat.** Each component added to the chat is now a chip on the chat bar ("About:" and then the chips), with its own × to take it out; Clear still takes them all. Built on the new StateUI `chipList`. Test: `editor.browser.test.ts` (two added, one taken out, the other kept).
- **The chat bar is even again.**
  - **One height.** The chat button, the request, the model menu and Send are all 36 px, 6 px apart, with the same space at both ends. Before, they were 32 and 36 px, aligned at the bottom, and 3 px apart.
  - **The request.** Its line sits in the middle of its box, it has 18 px corners so its focus ring is round like the bar, and its text starts 14 px in.
  - **The corners and lines.** The bar keeps 25 px corners when the lines above it show, instead of rounding into a lozenge as a pill would. The "About" and status lines sit 14 px in, as the old ones did.
  - A model name too long for its menu now ends in "…".
  - Test: `editor.browser.test.ts` now checks the chat bar's spaces and heights with the top corners'.
- **The top corners are spaced evenly.** Their parts are 6 px apart, as wide as the corners' own padding (it was 3 px, so the logo almost touched the name). Open is a soft button, so its box shows like the frame size menu's, and the menu is as tall as Open now that a field has no space under it for an empty message. Test: `editor.browser.test.ts` (one gap, the same padding at both ends, one height).
- **The editor draws the old editor's icons.** The chat, Send, Use, Move, Select, zoom out, zoom in, fit and appearance buttons show the glyphs of the hand-written editor (41fa580) again, from the editor app's own icon set (`EDITOR_ICONS`, given to `ui_app_create` as `icons`) instead of the nearest Tabler icons. The old appearance circle is written as a path. A person's untouched editor is made again, since the definition changed. Tests: `editor.browser.test.ts` (each button draws its old paths), `inspectRoutes.test.ts` (the served document carries the icons, and the icons map leaves them out).
- **The editor is held to the old design by a test.** `editor.browser.test.ts` measures the name and Share corners, the rail, the zoom and the chat bar at a wide window, and compares them with what the old editor (41fa580) measured. Heights may differ by 4% or 8 px, widths by 15%; the chat bar must be 640 px, and the corners sized by what they hold. It found the rail's toggles had lost the 4 px gap between them; they have it again.
- **`npm run ui:build` and `npm run magnetic:dev`** in the workspace: the UI layers built in order in about 20 s, then Magnetic started.

- **Add a component to the chat.**
  - **In the editor.** With a component selected, the Properties tab has "Add to chat". The component shows on the chat bar by its type and key, as "About: button · save", alongside anything else the next request is about (up to five). Clear removes them.
  - **For the agent.** The next request gives it the component as the app mounts it, two levels deep: which component it is, its settings and what it holds. Before, a node came only as a one-line note.
  - **Text.** "Add to chat" in English, German, French and Spanish.
  - Tests: `editor.browser.test.ts` and `agentRoutes.test.ts`.
- **The inspector scrolls, and is a bottom sheet in a narrow window.**
  - **Scrolling.** Its tabs take its height and the open tab scrolls. Before, a component with many properties spilled out below it.
  - **Narrow windows.** Below 760 px it is a sheet across the bottom, 45% of the height, as the old editor's was, so the app stays in view. It also stays above the chat bar when the bar shows what the request is about.

- **The editor matches the old one, checked side by side against commit 41fa580.**
  - **Theme.** Words and buttons are in the regular weight; the app's name is bold; floating panels have 12 px corners (`panel.radius`).
  - **Icons.** They are ink, not accent, and the appearance button uses the old half-filled circle (`contrast`).
  - **Pill panels.** A pill panel's clip and shadow are round at its ends.
  - **Canvas fit.** It fits around whichever rail is showing, and again when the other rail takes its place, until you pan or zoom yourself. Before, a narrow window put the frame under the top rail.

- **The editor is compact again, as it was before it became a StateUI app.**
  - **Panels size to their contents.** The corners, the rail and the zoom have no fixed width any more (they were 440, 104 and 196 px).
  - **The rail** has the tools, a line, a small uppercase "Show" and the toggles.
  - **The chat bar** is a pill: a borderless request box, the model in a soft pill and a round Send button, all on one line.
  - **Narrow windows**, as the old CSS had them:
    - every panel narrows to fit the window;
    - below 1120 px the zoom moves above the chat bar;
    - below 760 px the rail runs along the top and the sheets open below it;
    - below 480 px the model menu is hidden.
  - Built on the new StateUI `corners`, field `variant`, `text` `caps`, content-sized `adhoc` panels and `wrap: false`.

- **A layout shows itself while you point at it.** With the select tool, the pointer over a layout rather than over one of its children (in a gap, an empty track, the empty part of the area) shows that layout: its area dotted, each child as a box, the gaps hatched and, in a grid, every cell outlined, filled or not, under a tag with the layout and its settings (`panel · cards · grid cols 3 gap md`). Over a child, the child is outlined as before. Tests: `editor.browser.test.ts`.
- **The editor looks and works as it did, now in StateUI.** Magnetic's apps (the editor, the sign-in and link pages) use a `magnetic` theme, made with the theme tools, holding the colours, shadow and corners Magnetic's CSS had, light and dark. The logo is the way back to your apps again (a clickable `image`); the rail is in the middle of the left edge (adhoc `center`) with the tools one above the other and the Show toggles as buttons that fill while on; the chat bar and the chat are centred at their old width. V, H, S, 0, 1, - and = and Escape work with the focus in the editor too, but not while you type there. The panels cast their shadows again (the page draws them under the clipped frame), and the app no longer shows at the top left for a moment before the canvas fits it. Tests: `editor.browser.test.ts`.
- **Magnetic is made with StateUI, and you can edit the editor.** The editor (its corners, the rail, the zoom, the chat bar and the chat, the inspector, the Share and appearance sheets, a blank app's ideas) is a StateUI app, `magnetic-editor`, and looks as it did: panels floating over the canvas. The canvas stays the page's (the app's live frame on a board that pans and zooms); the editor's frame covers the window above it and the page clips it to the panels, from where the frame says they are (`watch`), so every other click reaches the canvas. The page drives the editor only through its data (`$.data.editor` and its lists) and its emits, and finds two parts by their key (`stage`, `propertyFields`), so the editor can be changed freely. Each person has their own copy, made from Magnetic's in their language: Your apps has Edit the editor (it opens in the editor, and each change shows in the editor around it at once) and Reset the editor; Magnetic's copy replaces an untouched one when it ships a new editor, and a person whose editor does not load gets Magnetic's with a note. The sign-in and share-link pages are StateUI apps too (`magnetic-signin`, `magnetic-link`), and every app Magnetic makes for itself carries German, French and Spanish as locales, written with `ui_locale_write`. Tests: `EditorApp.test.ts`, `editor.browser.test.ts` (driving the editor's frame), and the route tests.
- **Dark mode and four languages.** Each person picks light, dark or the system's look, and English, German, French or Spanish: in two menus at the top of Your apps, and in a sheet beside Share in the editor. The choice is kept per person (`users/<id>/magnetic/prefs.json`, `POST /prefs`); until they choose, Magnetic follows the system and the browser's language. Every page follows it: the sign-in and link pages, Your apps, the editor, the chat, the share sheet, the inspector (one app per language) and the app frame itself, whose components speak the language too. The words are in `src/http/text.ts`, checked complete for every language by the type. Tests: `Preferences.test.ts`, `agentRoutes.test.ts`.

- **The inspector matches the editor.** It follows the system's light or dark setting, as the editor's panels do, and switches when it changes.

- **A blank app says what to do.** The editor of an app with nothing on its screens shows, over the empty frame, a note to tell the agent what to build and three ideas; an idea fills the chat box, and the note goes once a request is sent (and while the chat is open). Test: `agentRoutes.test.ts`.
- **Your apps, laid out.** The home page is a centred column: Magnetic and Sign out, a "Make an app" box with the name field beside its button, then your apps and the apps shared with you as tight rows of cards; it fills a phone's width.
- **The inspector has room.** Add lists each component as a card with its name and a short summary, in a list that fills the panel; the State tab's tree and its changes feed have heights of their own, so the tree shows more than one row.

- **Closing the inspector lets the selection go.** The inspector's close button, pressing the Select tool again, or V (the Use tool) now clears the selected part's outline and closes the inspector. The Hand tool keeps both. Test: `editor.browser.test.ts`.
- **The inspector starts closed.** The editor opens with the Use tool on and the inspector hidden; the Select tool opens it. While hidden it still loads (it is invisible, not removed), so it opens with its tabs ready. Test: `editor.browser.test.ts`.
- **Fix: the chat closes.** Its close button and Escape closed the chat, then put the focus back in the chat bar, and focusing the bar opens the chat, so it opened again at once. The focus a close puts back no longer opens it. Test: `editor.browser.test.ts`.
- **The inspector: edit by hand, and see the state.** A panel at the right of the editor, itself a StateUI app,
  with three tabs. Properties edits the selected node, a field per property. Add places a component where you
  click: between the children of a column or row, beside a cell of a grid, or at the point of an `adhoc`
  layout. State shows `$.data` as a tree, which nodes show each path and which logic reads and writes it, and a
  feed of changes as they happen. The Select tool (S) outlines and selects a part of the app; drag it or press
  Alt+Arrow to move it, Delete to remove it. Every change is one checked `ui_nodes_write`. "Ask the agent" adds a
  path to the next turn, and the Data toggle shows the shape of the data above the chat bar.
- **The logo.** Every page has it as its icon, the sign-in page and the editor show it, and `/assets/logo.svg`
  serves it.
- **Your apps is a StateUI app.** The home page is the app `your-apps` in each workspace: a grid of cards, one
  per app and one per app shared with the person, a field and button to make an app, and Sign out. Magnetic
  writes the lists into its data on each visit. A card opens the app at `/apps/<appId>`, full page, with no
  editor. It is made again when Magnetic ships a new definition (a stamp in `users/<id>/magnetic/home.json`).
- **Ctrl+Shift+E opens the editor on the app** (Cmd+Shift+E on a Mac), and again closes it. The canvas, the
  panels and the chat come in over the app, which can then be panned and zoomed. The address switches between
  `/apps/<appId>` and `/edit/<appId>` without a reload. The key works while the app has focus, as the runtime
  hands it to the page. A hint shows it the first time an app is opened.
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
