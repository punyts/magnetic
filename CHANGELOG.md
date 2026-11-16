# Changelog

## 0.1.0 (unreleased)

- **Buying agent use after the allowance** (docs/design/magnetic-payments.md).
  - **The Agent use page,** `/settings/billing` (Agent use on Your apps): the allowance, what was added, used and is left; a button per amount on offer (`--top-ups`, default $10, $25, $50); and the person's payments and refunds. Four languages.
  - **Stripe Checkout,** called with fetch: the person pays on Stripe's page and comes back; Magnetic never sees a card. `MAGNETIC_STRIPE_SECRET_KEY` and `MAGNETIC_STRIPE_WEBHOOK_SECRET`, both or none.
  - **The webhook,** `POST /billing/stripe`, is the only thing that adds credit: it checks Stripe's signature and time, takes usd only, and keeps the ledger `agent_credit` (migration 0008), keyed so the same news twice adds nothing. A refund takes the refunded total off.
  - **Budgets** count what was bought on top of the allowance. While a person spends it, the daily limit and the server's monthly budget do not stop them. The refusals point to Agent use when buying is on.
  - Tests: `billing/billing.test.ts` (7), options (1), and `e2e/billing.spec.ts` (2 at two sizes) against a stand-in Stripe on the test server's API port.

- **Reading another owner's data** (docs/design/magnetic-shared-data.md).
  - **The Data page,** `/settings/data` (Data on Your apps), tabbed by the workspaces a person manages:
    - each of the workspace's datasets, with whom it is shared, Stop sharing, and a form to share it read only with a person's verified email or an org's short name;
    - the datasets other owners shared with this workspace, with the `uses.external` that reads one.
  - **A share is a standing signed grant** (`StateGrants`), from the workspace to the other workspace, on the address `<workspace>/<dataset>/data`, read only on `$`, until it is stopped. The audit names the person who shared or stopped it. Shared by me lists it, as "the dataset <name>". An org whose policy keeps grants in the org refuses sharing outside it.
  - **An app reads it** with `uses.external.<alias> = { owner, dataset }` (stateui-app). Its records show at `$.external.<alias>`, live, and the logic runs on their changes; the app can never write them. `SharedData` checks the signed grant as a read opens and on each change, and stopping a share clears the reading apps at once.
  - **The agent is told** what datasets are shared with the app's workspace, with their fields and how to read each.
  - **A Shared data panel in the editor** (rail button, key D): the datasets shared with the app's workspace, who shared each and its fields, from `GET /edit/<id>/shared-data`. Pressing one asks the agent to show it in the app; Manage data opens the Data page.
  - Tests: `sharing/sharedData.test.ts` (6), and `e2e/data.spec.ts` (4 at two sizes), with a `/dataset` control route that seeds a dataset and a verified email.

- **M8's gaps filled.**
  - **An org can turn connections off.** A new policy, `connections` (on by default), on the org's settings page. While it is off:
    - every call of the org's apps is refused, with the reason in the effect's status;
    - the agent is not told of the org's connections;
    - the Connections page says so and offers no Try.
  - **The Connections page speaks four languages** (`http/connectionText.ts`), as the other pages do. The reasons a change was refused still come in English, as on the org pages.
  - **A Connections panel in the editor** (rail button, key C), in the library's place:
    - it lists the endpoints of the app's workspace, with their method, host, path and params, from `GET /edit/<id>/connections` (never a key or secret);
    - pressing one asks the agent to show what it answers in the app;
    - Manage connections opens the Connections page, for those who manage the workspace's connections.
  - **The editor's top bar names the workspace** the app is in: "Yours", or the org's name.
  - Tests:
    - `appCalls.test.ts`: the panel's answer, and an org's calls refused while its policy is off and made again once it is on;
    - `e2e/connections.spec.ts`: the page in German, the editor panel asking the agent, and an org with connections off.

- **Connections: apps call outside APIs** (M8, N6).
  - **The page.** `/settings/connections` (Connections on Your apps) holds the connections of a workspace: the person's own, or an org's they are an admin or owner of. A connection has a name, an https base URL, how it signs in, and its endpoints.
    - **Sign-in:** none; a key in a header or the query; OAuth 2 client credentials; or OAuth 2 sign-in with refresh, through Connect (state and PKCE, `/connections/oauth/callback`).
    - **Endpoints:** a name, a method, a path with `{params}`, query values, a JSON body, and where the records are in the answer.
    - **Try** calls an endpoint and shows its answer.
  - **Secrets stay on the server.** Keys, client secrets and tokens are sealed with the server's key (`SecretBox`, migration 0007). The page shows only whether each is set. Nothing goes into a document, an app's state, a page or the agent.
  - **Apps call through a logic effect.** `logic.effects.<name> = { request, run: "http", status, value | records }`, with `{ connection, endpoint, params }` written at the request path. Each running app gets its own effect, bound to its workspace through stateui-mcp's new per-instance `logicFunctions`. The answer lands where effects put it; a refusal lands in the status with its reason.
  - **Guarded** (`connections/guard.ts`):
    - https only, and no user or password in a URL;
    - only the connection's own host, and a param cannot leave the path;
    - every address the name resolves to is checked as the call connects, so no private, loopback, link-local (169.254.169.254), CGNAT or reserved address, in IPv4 or IPv6, can be reached;
    - no redirect is followed;
    - 10 s, 1 MB, and 60 calls a minute per app;
    - each call is reported with its workspace, app, connection, endpoint, status and time, and never a secret or a body.
  - **The agent is told** each connection's name and host, and its endpoints with their params, with every request. It writes effects that call them, and never makes connections.
  - **Sharing.** The Share panel says that a use link calls the app's outside APIs with the owner's connections.
  - Tests:
    - `connections.test.ts`: the guard's ranges and URLs, a name resolving to loopback, no redirect, the 1 MB cap; keys, client credentials, bodies, refusals, the rate limit, staying on the host; the agent's facts with no key;
    - `appCalls.test.ts`: an app's own logic calling a connection through the server, the answer in its state and the key nowhere in it;
    - `e2e/connections.spec.ts`: a key connection tried, a bad URL refused, OAuth connected through a stand-in provider and called, deletion.

- **Adding people to an org** (M8, N5).
  - **Invites wait on Your apps.** An invite to the verified email of someone who uses Magnetic shows on their Your apps under Invitations ("Join Acme · As a builder · from Ana"), with Join and Decline.
    - Joining opens the org.
    - Declining takes the invite away and stops its link (`declined_at`, migration 0006).
    - The page shows invites only to the person whose verified email they name, and not for an org they are in already (`Orgs.pendingFor`, `acceptInvite`, `decline`; `POST /orgs/invites/<id>/accept|decline`).
  - **Invites are emailed.** With `MAGNETIC_MAIL_FROM` (and `MAGNETIC_MAIL_REGION`, default us-east-2), an invite is sent through Amazon SES (`sesMailer`, `@aws-sdk/client-sesv2`): who invited whom to what, the link and when it ends, in plain text and in HTML. The settings page says it was emailed, and still shows the link once. A send SES refuses (the sandbox, a missing permission) is reported, and the link is shown as before. The JSON invite answer has `mailed`.
  - **Your apps lists your orgs** with your role. Each opens its settings, and Make an org opens the org page.
  - **Not as planned:** the plan added an existing person straight into the org. It asks them instead. Org admins can look at a member's state in org apps, and an answer that said "added" would have told an admin whether an email has an account.
  - **Text.** The new words are in English, German, French and Spanish.
  - Tests:
    - `orgs.test.ts`: waiting invites, joining and declining by id, a declined link;
    - `mail.test.ts`: the email's words and escaping, mailed and failed sends;
    - `e2e/orgs.spec.ts`: emailed, joined and declined from Your apps, and orgs listed.

- **Screens: a panel to add and manage them, and every screen on the canvas** (M8, N4).
  - **The Screens panel** takes the library's place beside the rail (the two take turns). The rail's new Screens button, or `P`, shows and hides it. It lists the app's screens, marks the one worked on and the one the app opens on, and can:
    - add a screen by name (a blank column);
    - rename the one worked on;
    - copy it with its parts;
    - make the app open on it;
    - delete it (asking first; never the screen the app opens on).
    A name that is not a screen name is refused with the rule.
  - **The canvas** shows every screen as a frame, left to right in the app's order. The live frame (the app, synced, inspected and edited) is in the slot of the screen it shows, labelled with the app's and the screen's names. Every other screen is a preview: the app's document opened on that screen, given the live data and kept in step with it.
  - **Choosing a screen.** Pressing a preview, or a screen in the panel, makes it the screen worked on: the live frame navigates there and takes the preview's place. When the app navigates by itself, the board moves so the live frame stays where it was.
  - **Weight.** Only the previews in view run, at most six. One out of view shows its name.
  - **Server:** `GET /edit/<id>/screens` lists the screens and the start screen. `POST` with `action` (`add`, `copy`, `rename`, `delete`, `home`) runs `ui_screen_create`, `ui_rename`, `ui_delete` or `ui_app_configure`, and answers with the list.
  - **Script:** `/assets/screens.js` (`SCREENS_JS`).
  - **Text:** the new words are in English, German, French and Spanish.
  - Tests:
    - `e2e/screens.spec.ts` (desktop): the panel and the frames in order, a preview pressed taking its place, copy, rename, open-on and delete, a bad name, previews out of view not running;
    - `inspectRoutes.test.ts`: the screens route;
    - `editor.browser.test.ts`: the rail with one more button.

- **Set a layout and a part's place in it by hand** (M8, N3). The inspector's Properties tab opens with two new sections, above the component's own properties:
  - **Layout**, on a node that lays out parts (a panel, a card, a screen): its type (column, row, grid, region or free-form `adhoc`), then that type's settings, such as gap, align, wrap, columns and rows. The fields come from stateui-app's `LAYOUTS`, so they follow the closed list.
  - **Place in its parent**, on a node inside a layout: the fields that layout gives a child, such as grow and height in a column, column, row and span in a grid, the area in a region, or x, y and size in a free-form layout.
  - **Changing the type** keeps the settings both types have (a column's gap stays when it becomes a row), drops the rest, and clears the children's placement fields the new type lacks, all in one write.
  - **The server** (`/edit/<id>/node`) now answers with the parent's layout type, the children's placements, and whether the component lays out parts. `/components` also returns the layouts. magnetic now depends on `@punyts/stateui-app` directly.
  - **Text.** The new labels are in English, German, French and Spanish.
  - Tests:
    - `e2e/editor.spec.ts` "Layout and placement": a column made a grid of two, a part spanning two columns, the gap kept from a column to a row;
    - `inspectRoutes.test.ts`: the node's layout answers.

- **The component library is a panel of its own, and components drag onto the app** (M8, N2).
  - **Where it is.** The library left the inspector's Add tab for a panel beside the rail. It shows when the editor opens on a wide window, and on a phone it is a sheet across the bottom that starts hidden. The rail's new Components button, or `A`, shows and hides it, and the browser remembers the choice. A fitted app is fitted again to the right of it. The inspector keeps Properties and State.
  - **Search as you type.** The search narrows the list with each letter, through `searchBox`'s new `input` event. Before, it narrowed only on Enter or when the box was left.
  - **Drag.** A card drags onto the app. The card (now `draggable`) holds the pointer and emits `grab`, `dragMove` and `dragEnd` with the pointer's place. The editor's frame covers the window, so the page reads those as its own pixels. Over the app frame the drop line shows where the component would land. Let go there, it lands as one `add`. Let go anywhere else, or press Escape, and it is cancelled.
  - **Press, then click.** Pressing a card and clicking the app still places it, which is the way on a phone.
  - **Text.** The panel's words are in English, German, French and Spanish.
  - Tests:
    - `e2e/editor.spec.ts`: shown and hidden, search by letter and category, press-then-click, drag and drop, a drop outside;
    - `inspectRoutes.test.ts`, `editor.browser.test.ts`: the rail is one button taller than the old editor's.

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
