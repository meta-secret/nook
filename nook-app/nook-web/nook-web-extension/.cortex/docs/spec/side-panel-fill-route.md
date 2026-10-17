# Side-Panel This Site And Fill Route

Accepted requirement: the extension side panel lists the active tab's saved
logins under This site and fills one only after an explicit Fill. The panel
sends only an opaque item identity and a window selector. The service worker
derives the tab and origin itself. Rust classifies the page and re-matches the
item. The top-frame content script reveals the login through the existing
sender-bound path and fills it. Fill never submits, and no plaintext reaches
the panel.

The panel's states and layout belong to the
[browser extension toolbar behavior](browser-extension.md#toolbar-behavior).
Login eligibility follows
[general login website matching](browser-extension.md#general-login-website-matching).

## Panel sender and payload

- The service worker admits a This site or Fill request only from the
  side-panel document. That sender carries this extension's id and the exact
  side-panel page URL, with no `tab`, `frameId`, or `documentId`.
- Every other sender receives `forbidden`:
  - content scripts and the login-picker frame;
  - the authentication tab and the offscreen document;
  - other extensions and side-panel path variants;
  - the side-panel page opened in a normal tab.
- A listing request carries only `windowId`. A Fill request carries only
  `windowId` and the opaque `itemId` (`vaultStoreId`, `secretId`).
  - Strict decoding rejects unknown fields and bounds every string.
  - An undecodable request receives `forbidden`.
  - No request carries an origin, URL, host, tab id, frame id, or username.
- The side-panel page is not web-accessible. The manifest adds only the
  `sidePanel` permission.

- **Prohibited:** accept a panel-supplied origin or tab id, or admit the panel
  through a check that any same-extension page passes.
- **Required:** admit only the side-panel sender shape with a strictly decoded
  payload. Answer every other sender or payload with `forbidden`.

## Active-tab target

Chrome does not identify a side panel's window to the service worker, so the
panel supplies `windowId` from its own window. That value selects a window and
grants no authority. Both routes resolve the target the same way, and Fill
resolves it again at Fill time.

1. The service worker reads the selected window itself. The window must exist,
   be a normal window, and match the extension's incognito context.
   - Otherwise the route returns `page-unavailable`.
2. It queries that window's active tab and requires exactly one tab with an
   integer id.
   - Otherwise the route returns `page-unavailable`.
3. It reads the tab URL itself and passes it unchanged to Rust/WASM.
   TypeScript never parses or classifies the URL, and nothing stores or logs
   it.
4. Rust classifies the URL as a website, a non-web page, or a Nook vault app.
   - **Website:** only an `http:` or `https:` URL with a host. Its origin
     follows URL origin semantics.
   - **Display host:** lowercase, without userinfo, port, path, query, or
     fragment. It keeps `www` and punycode, so a lookalike internationalized
     name cannot display as the name of another site.
   - **Non-web page:** `chrome:`, `chrome-extension:`, `about:` including
     `about:blank`, `data:`, `file:`, `view-source:`, `javascript:`, `blob:`,
     `ftp:`, and `wss:` pages. An empty, malformed, or missing URL is non-web
     too. The route returns `non-web`, and the panel says that the tab has no
     website.
   - **Nook vault app:** Simple and Sentinel production, development, and PR
     preview hosts, including their trailing-dot forms. The route returns
     `page-unavailable`, and the panel says that Nook cannot fill on this
     page. A lookalike such as
     `simple.nokey.sh.example.com` stays a website.
   - Neither non-website result calls the vault session or lists logins.
5. If the tab query or the classification fails, the listing returns
   `list-failed` and Fill returns `fill-failed`. Such a failure is never shown
   as a page state.

- **Prohibited:** report a failed tab query as a tab without a website, or
  format the display host from the tab URL in TypeScript.
- **Required:** return `list-failed` or `fill-failed` for that failure. Show
  only the display host that Rust derived from the active tab.

## This site listing

1. The service worker admits the sender and decodes the payload.
2. It resolves the [active-tab target](#active-tab-target). Only a website
   continues.
3. The authorization generation must be current, with no lock cleanup
   pending.
   - Otherwise the route returns `locked`.
4. A password-filling grant must exist.
   - Otherwise the route returns `unpaired`.
5. A session status probe must report an unlocked session.
   - A locked session returns `locked`.
   - A failed probe returns `list-failed`.
6. The fail-closed Rust login listing for the derived origin supplies the
   rows.
   - It lists Login items only. Authenticators are never requested, merged, or
     guessed from an issuer, label, or host.
   - A failed or malformed grant answer returns `list-failed`, never an empty
     list.
7. The service worker checks the generation again after the listing.
   - A stale generation returns `locked`.

The listing obeys these rules:

- The reply holds the Rust display host and, for each login, its opaque item
  id, username, and vault label. It carries no password, saved website URL, tab
  URL, authorization generation, or device key.
- The route never opens the authentication tab.
- The panel keeps the listing in component memory. It clears the listing on
  lock or session-state change, on tab activation or URL change in its window,
  and when the panel hides or unloads.
- The panel never reads, logs, or stores the tab URL or origin.
- One matching login gets the primary Fill. Several matching logins each get
  a secondary Fill.
- The listing outcomes form a closed set, and each renders English and Russian
  catalog text:
  - **Ready:** `ready` with its logins. The empty state naming the site
    appears only for a ready listing with no logins.
  - **Request or page:** `forbidden`, `non-web`, and `page-unavailable`.
  - **Session and grants:** `unpaired` and `locked`.
  - **Failure:** `list-failed`.

- **Prohibited:** show "no saved logins" after a grant transport fails, list an
  authenticator whose issuer names the site, or show an unlocked list after a
  lock cleanup started.
- **Required:** return `list-failed` for that failure and list only
  Rust-matched Login items. Return `locked` while the generation is stale or a
  cleanup is pending.

## Fill

The service worker checks the request first:

1. It admits the sender and decodes the payload, as for the listing.
2. It resolves the [active-tab target](#active-tab-target) again. Nothing
   about the target is reused from the listing.
3. The authorization generation must be current, with no lock cleanup
   pending.
   - Otherwise it returns `locked`.
4. It checks the password-filling grants.
   - With no password-filling grant, it returns `unpaired`.
   - When no grant covers the item's vault, it returns `item-not-found`.
5. A session status probe must report an unlocked session.
   - A locked session returns `locked` without opening the authentication
     tab.
   - A failed probe returns `fill-failed`.
6. It runs a fresh fail-closed listing for the item's vault and the derived
   origin.
   - A failed listing returns `fill-failed`.
   - If the exact item is absent, it returns `item-not-found` and sends
     nothing to the tab.
7. It checks the generation again.
   - A stale generation returns `locked`.
8. It messages only the tab's top frame. The message carries the derived
   origin, the item's opaque identity, and the current generation, and no
   credential.
   - If no content script answers, it returns `page-unavailable`.

The top-frame content script then fills:

1. It accepts the trigger only as a runtime message from this extension. A
   page `postMessage`, DOM event, or page-world bridge never triggers a fill,
   and subframes ignore the trigger.
   - An undecodable trigger returns `fill-failed`.
   - If its own origin differs from the derived origin, it returns
     `tab-changed` and requests no reveal.
   - While a Pilot fill is interacting or actuating, it returns `fill-failed`.
2. Rust's fill-saved-login capability must allow the document's workflow. Only
   a Login workflow qualifies, including a username-only step.
   - Otherwise it returns `no-login-form` and requests no reveal. Signup,
     password-change, one-time-code, and manual-checkpoint workflows return
     `no-login-form`.
   - If the workflow cannot be discovered, it returns `fill-failed`.
3. It revalidates the workflow, then reveals through the existing
   sender-bound `nook:website-login-fill` path. Rust re-matches the item
   against the content script's own origin.
   - If that revalidation fails, it returns `no-login-form`.
   - A lock that the reveal observes returns `locked`.
   - Any other reveal failure returns `fill-failed` and leaves the fields
     untouched.
4. It confirms the Fill is still approved and revalidates the workflow again
   before writing.
   - A session change withdraws the Fill, which returns `fill-failed`.
   - A Pilot fill that started meanwhile returns `fill-failed`.
   - If revalidation fails after a partial fill, it clears the filled fields
     and returns `fill-failed`.
5. It writes the values only into the revalidated login fields and returns
   `filled`.

The route enforces these limits:

- Fill never submits a form, activates Next or another advance control, or
  starts a continuation. On Google's identifier step it fills the username
  only, unlike the
  [selected Google username advance](browser-extension.md#google-two-step-login).
- Plaintext lives only in the content script's locals for that one fill.
  Replies to the service worker and to the panel carry only the outcome.
- The panel never calls `chrome.tabs.sendMessage` or `chrome.scripting`.
  The extension has no `scripting` permission.
- The route writes no browser storage, IndexedDB record, pending request, or
  vault event. A later manual submit follows the existing login-save path.
- The route never retries, reports silent success, or falls back to Pilot or
  the authentication tab.
- Neither route logs on success. An unexpected failure logs at most a constant
  message and its outcome kind, never a username, URL, item identity, or
  listing content.
- The Fill outcomes form a closed set, and each renders English and Russian
  catalog text:
  - **Success:** `filled`.
  - **Request or page:** `forbidden`, `non-web`, `page-unavailable`, and
    `tab-changed`.
  - **Session and grants:** `locked`, `unpaired`, and `item-not-found`.
  - **Form or fill:** `no-login-form` and `fill-failed`.

- **Prohibited:** reuse the listing's origin after the user switched tabs,
  submit the form after Fill, or return the username to the panel.
- **Required:** derive the origin again at Fill and require the item in a fresh
  listing. Return `tab-changed` when the page's origin changed before delivery.
  Fill only the revalidated fields, then reply `filled` alone.

## Session gate and panel isolation

- The offscreen session refuses every request from a content script or any
  other sender outside the extension. Content scripts never reach it directly.
- Only the service worker may send a request that does any of these:
  - reveals a login, or lists or uses authenticators or passkeys;
  - writes, imports, exports, or pairs vault data, or joins or refreshes an
    identity;
  - stages a login save or seals identity material;
  - resets the session, migrates providers, or classifies grant authority.
- The remaining session requests are accepted from the service worker or an
  extension page. They cover device status, setup, recovery, unlock, and lock.
  They also cover identity connection and activation, the vault summary, and
  login listing.
  - Login listing returns only non-secret metadata: usernames, vault labels,
    and opaque item identities.
- The panel registers no `chrome.runtime.onMessage` listener, because runtime
  broadcasts can carry plaintext.
- The panel's outgoing messages form a closed set. The set holds the two
  side-panel requests, lock, open vault, open tab, and paired-vault queries. It
  also holds the status, setup, and unlock requests of the shared
  device-protection component.
  - None of them lists logins, reveals a credential, or returns a vault secret.

- **Prohibited:** the side panel reveals a login through the offscreen session,
  or lists logins there instead of through the service worker.
- **Required:** the offscreen gate refuses the reveal from any extension page.
  The panel reaches login data only through the service worker's This site and
  Fill requests.
