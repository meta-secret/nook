# Sign-In Attempt Lifecycle

## Decision

Nook Pilot's **Sign in** is a Rust-owned lifecycle, not a fire-and-forget
fill. One click (and the login choice, when several match) begins one attempt
for the tab. Rust decides every transition, classification, timeout, offered
action, message key, and whether the record is kept. The attempt never falls
back to the Pilot's initial state on its own: it shows **Signing in…** and then
exactly one visible end state.

## Ownership

### Rust (`nook-companion-core`, module `sign_in_attempt`)

- Request, evidence, record, transition, and presentation types, with strict
  decoding and bounds.
- Site binding of the sender origin to the record.
- Phase transitions and the retain/close disposition.
- Post-submit outcome classification: failure, challenge, step progression,
  and sign-in.
- Error-looking message selection and failure-reason categories.
- Password-reset link classification and click-time revalidation.
- The outcome budget and stability windows.
- Offered actions, message-key selection, and the checklist projection.

### WASM (`nook-companion-wasm`)

- `begin_sign_in_attempt(request: &Ts<SignInAttemptBeginRequest>)` and
  `advance_sign_in_attempt(request: &Ts<SignInAttemptAdvanceRequest>)`.
- Both exports keep snake_case names and Rust field names, with no `js_name`
  and no serde casing renames.
- `JsError` is reserved for a malformed request. Its message is fixed text and
  never echoes request content.
- A stored record that fails strict decoding is the typed outcome
  `RecordRejected`, not an error.

### Browser adapters

- The service worker binds each request to `sender.tab.id`, the top-level
  frame, and the sender origin (`URL.origin`).
- It stores the opaque record string under
  `nook.extension.sign-in-attempt.<tabId>` in `chrome.storage.session` and
  calls `begin_sign_in_attempt` / `advance_sign_in_attempt` itself. There is
  no offscreen hop for this lifecycle.
- It removes the key on `Close`, `RecordRejected`, and tab removal.
- It processes each tab's events in order, one at a time, each against the
  record the previous event stored.
- Content scripts are sensors and actuators only. They collect bounded page
  facts, render presentations, and execute the selected follow-up.

Ordering requirement: the acting content script delivers `Submitted { baseline }`,
and the service worker processes it, before a submit that can navigate away.
`Resumed`, or a `PageObserved` from a `NewDocument`, that arrives before a
recorded submit concludes `TimedOut`. Rust never assumes that an unrecorded
submit happened.

The acting content script also reports the document relation of each
observation. `SameDocumentSameRoute` means `location.pathname` still equals the
pathname it captured at its own submit. `SameDocumentNewRoute` means the
pathname changed. `NewDocument` means a resumed instance observed the page
after a load. The pathname is an in-memory fact of that content script and is
never stored.

## Record shape and lifetime

The record is JSON that TypeScript stores and returns verbatim:

- `schema`: the supported revision (`1`). There is one writer and no
  compatibility reader.
- `origin`: the exact canonical origin that began the attempt, for example
  `https://www.namecheap.com`. Its schemeful site binds the record.
- `login`: the opaque login reference `${vaultStoreId}/${secretId}`, at most
  1 KiB. It is split at the first `/`, both components must be non-blank, and
  control characters are rejected. Legacy secret labels with spaces,
  non-ASCII text, or `/` are accepted. It identifies a vault item and is not a
  credential value.
- `started_at`: a validated Unix-millisecond instant.
- `phase`, one of:
  - `BeforeSubmit` with step `Filling`, `Filled`, or `ManualSubmit`.
  - `AwaitingOutcome`, holding the submit instant, the baseline, and the
    stability state.
  - `Concluded`, which is `Failed`, `ChallengeRequired`, or `TimedOut`,
    together with the latest login-form evidence (`Shown`, `Gone`, or
    `Unobserved`). Try again, Choose another login, and Fill 2FA code are
    offered only while the form is `Shown`.

The submit baseline keeps only three facts:

- whether an error-looking message (same rule as after submit) was visible at
  submit;
- which auth fields (username, current password, one-time code) were present;
- whether a sign-out style authenticated affordance was present. This is
  derived from the bounded control labels with the existing login-save
  `LoginControlLabel::semantics` / `AuthenticatedControlEvidence` rule.

Submit-time message text, tokens, colours, and control labels are classified
once and dropped. The only page text a record ever holds is the one Rust-selected
site message of a failure: whitespace-normalized visible text, at most 300
characters. It is the site's own text and may contain what the site displays,
such as an email address. It is stored with the exact origin of the page it
was captured on (the sender of the concluding `PageObserved`). That origin can
differ from the beginning origin, for example in an SSO flow. Only that capture
origin is shown the message.

Decoding is strict. The stored text is at most 8 KiB. Unknown fields,
unsupported schema revisions, non-canonical origins, invalid login references,
invalid instants, and reversed chronology are all rejected. A record that
fails decoding yields `RecordRejected`: the service worker removes it and the
Pilot starts fresh. There is no repair, replay, or migration of old shapes.

Lifetime is the tab's session. `chrome.storage.session` is ephemeral and
cleared on tab removal. No durable vault schema or storage migration is
needed, because the record is non-secret and never written to vault storage.

Every request and record object is decoded strictly. Unknown fields are
rejected everywhere, including on tagged variants without a payload such as
`{ kind: 'Resumed' }`; Rust models those as empty struct variants so the rule
applies, and the TypeScript shape is unchanged.

## Transitions, end versus close

| From | Event | Result |
|---|---|---|
| begin | — | `BeforeSubmit(Filling)`, retained |
| BeforeSubmit | `Filled`, `SubmissionUnobserved` | `Filled`, `ManualSubmit` |
| BeforeSubmit | `Submitted { baseline }` | `AwaitingOutcome`, budget starts |
| BeforeSubmit | `FillFailed`, `SubmissionRejected` | `Failed` without a site reason |
| BeforeSubmit | `Resumed`, or `PageObserved(NewDocument)` | `TimedOut` (the acting document was lost before a recorded submit) |
| AwaitingOutcome | `PageObserved` | see classification below |
| AwaitingOutcome | `SubmissionUnobserved` | `BeforeSubmit(ManualSubmit)`: the actuator reports its submit outcome after `Submitted`, so the user submits |
| AwaitingOutcome | `SubmissionRejected` | `Failed` without a site reason, as before submit |
| AwaitingOutcome | `Resumed`, `Filled`, `FillFailed`, or an offered user action | keep waiting, or `TimedOut` after the budget |
| AwaitingOutcome | a new `Submitted` | restart the wait |
| any in-flight phase | `Dismiss` | close; take-over state |
| Concluded | `Resumed`, activity | re-present unchanged; site outcomes ask for page evidence; never expires |
| Concluded | `PageObserved` with an auth field visible | re-present unchanged, with the reset offer from that page |
| Concluded by the site | `PageObserved` from a `NewDocument` with no auth field visible | close as `WorkflowLeft`: no outcome claim, no actions |
| Concluded by the site | `PageObserved` on the same document with no auth field visible | re-present with the form recorded as gone (form-acting actions withdrawn) |
| Concluded by Nook (`FillFailed`, `SubmissionRejected`) | `PageObserved` | re-present unchanged; never closes as `WorkflowLeft`, never asks for page evidence |
| Concluded | offered user action | close with its follow-up |

Close, meaning the record is removed after the presentation is delivered,
applies to:

- signed in;
- step advanced;
- workflow left. A concluded record is never self-corrected into a success:
  once its page no longer shows a login workflow, it closes without a claim;
- dismissed;
- try again, choose another login, reset password;
- the authenticator hand-off.

Every closing presentation offers no actions and requests no page evidence.

The concluded actions are:

- **Failed** offers:
  - Try again (`RestartWithSameLogin`);
  - Choose another login (`OpenLoginPicker`);
  - Reset password (`ActivateResetLink`), only for a site rejection whose
    current page shows a revalidated reset link;
  - Dismiss, which returns to the fresh Pilot.
- **ChallengeRequired** offers:
  - for a one-time-code challenge, Fill 2FA code, which hands off to the
    existing authenticator picker;
  - for a verification checkpoint, Try again;
  - Dismiss as take-over in both cases.
- **TimedOut** offers Try again and Dismiss.

Try again, Choose another login, and Fill 2FA code act on the login form. They
are offered, and accepted, only while the latest page evidence shows an
authentication field; a same-document TimedOut whose form is gone offers
Dismiss only. Nook's own fill and submit failures count as showing the form.
Reset password depends only on a classified link.

For a site Failed, the first action is the primary button, and the order
follows the reason:

| Reason | Order |
|---|---|
| `AccountLocked` | Reset password (if offered), Choose another login, Try again, Dismiss |
| `RateLimited` | Dismiss, Choose another login, Reset password (if offered), Try again |
| `WrongCredentials`, `ChallengeRequired`, `Unknown` | Try again, Choose another login, Reset password (if offered), Dismiss |

A site Failed shows its reason as `description_key`; there is no separate
reason field. Nook-originated failures keep the checklist step description
(`widgetChecklistFillFailed` / `widgetChecklistSubmitRejected`).

A user action that is not offered re-presents the current state. Nothing is
retried automatically.

The presentation reuses the existing `AuthenticationLoginChecklistState`
projection for its rows. A site rejection uses the checklist result `Failed`
(row detail `widgetChecklistResultFailed`). A challenge uses
`ChallengeRequired` (`widgetChecklistResultChallenge`). A timeout keeps the
generic `Attention` copy. The header counter `progress` comes from the
existing `AuthenticationWorkflowActivity` and matches the rows:

- 1 for fresh, dismissed, step-advanced, and workflow-left states;
- 2 for Nook's own fill and submit, including fill failures;
- 3 once the site's response was awaited or reached.

`Dismissed` with checklist status `Inactive` is the take-over state.
`Dismissed` with checklist status `Ready` is a return to the fresh Pilot.

## Classification rules

### Post-submit decision order

`PageObserved` evidence is classified in this order:

1. The explicit error marker, alone or with a success marker, is `Failed`.
   The reason comes from a fresh error-looking message, or is `Unknown`.
2. A fresh error-looking message while the submitted step's username or
   password field is still visible is `Failed`, with that message.
3. A manual checkpoint is `ChallengeRequired(Verification)`. A one-time-code
   field that was absent at submit is `ChallengeRequired(OneTimeCode)`.
4. A current-password field that was absent at submit, with no marker and no
   fresh error-looking message, is `StepAdvanced`: an email-first step was
   accepted and the next step starts fresh.
5. The explicit success marker is `SignedIn`.
6. A page with no auth fields and no error-looking message is `SignedIn`
   once that evidence has been stable for the existing 750 ms interval
   (`LoginSaveOutcomeObservation::STABILITY_DELAY_MS`). This applies only to a
   `NewDocument` or a `SameDocumentNewRoute` observation. On
   `SameDocumentSameRoute`, removed fields alone never confirm sign-in; only
   the explicit success marker does, or a sign-out style authenticated
   affordance that was absent at submit, with the same 750 ms stability. This
   follows the submitted-login save precedent, where removing fields on the
   same route stays `Waiting` unless a new authenticated affordance appears.
   A same-route spinner therefore keeps waiting and ends as `TimedOut`.
7. The same username/password step re-presented on a new document, with no
   error-looking message, is `Failed` with reason `Unknown` once stable for
   2 s. The delay leaves time for client-rendered error text.
8. Otherwise the attempt keeps waiting. After 20 s from submit, the outcome
   budget ends it as `TimedOut`. The budget tolerates a full reload and a slow
   response. Decisive evidence is always evaluated before the budget.

### Freshness

A message counts as newly present:

- on a `NewDocument`, always;
- on the same document (`SameDocumentSameRoute` or `SameDocumentNewRoute`),
  when no error-looking message was visible at submit, or when the message's
  `changed_since_submit` is true. The acting content script sets that flag,
  in memory only, when the element was absent at its submit or its visible
  text changed since then. The flag is always false in a submit baseline and
  on a `NewDocument`.

Remaining limitation: when a site re-renders an identical error text into the
same element without replacing the node, the message is not fresh. The
attempt then ends as `TimedOut`, never as a guessed failure.

### Error-looking messages

No single weak signal suffices. A message is error-looking when its signals
reach a score of 3:

| Signal | Weight |
|---|---|
| `role=alert` or `role=status`; aria field reference | 2 |
| `aria-live` region | 1 |
| error token (`error`, `danger`, `invalid`, `fail`, …) | 2 |
| `alert` or `warn` token | 1 |
| reddish foreground or background | 2 |
| failure-reason vocabulary | 2 |
| generic error vocabulary | 1 |

- A success or info token on the element itself (`tokens`) vetoes a message
  unless an error token is also present. Ancestor tokens (`ancestor_tokens`)
  contribute error and weak stems but never veto, so a wrapper `info` or
  `ok` class cannot hide a styled error banner.
- When several messages qualify, the highest score wins. Ties go to a message
  inside the form, then to the earlier message.
- The Namecheap lock banner qualifies: it is a plain container with no role,
  no `aria-live`, a reddish colour, and lock wording.

### Reason categories

Categories are `WrongCredentials`, `AccountLocked`, `RateLimited`, and
`ChallengeRequired`, read from English and Russian vocabulary.

- A consequence (locked, rate limited, extra verification) takes precedence
  over wrong-credential wording, because lock messages explain themselves
  with failed attempts.
- Two consequences together, or no category, give `Unknown`. A category is
  never guessed.
- `RateLimited` needs explicit throttling wording ("too many", "rate limit",
  "slow down", "слишком много/част"). Timing advice such as "try again later"
  is only generic error wording, so it never decides a category.
- Lock wording matches only at word starts, so "blocked", "unlocked", and
  "разблокировка" do not read as `AccountLocked`.

### Reset links

A reset link must be:

- an absolute `http(s)` URL on the record's site;
- worded with reset, forgot, recover, or Russian equivalents in its text or
  path.

The same rule revalidates the clicked link before `ActivateResetLink`. Link
indices are content-script-local, so a reset offer comes only from links
collected on the current document. A failure re-presented after a reload asks
for fresh page evidence first.

### Site binding

A site is the URL scheme plus the PSL registrable domain, or the exact host
when there is none (IP addresses, `localhost`, a bare public suffix). The
sender origin must be a canonical `http(s)` origin:

- `begin` rejects anything else as a malformed request;
- `advance` answers `OtherSite` and leaves the record stored.

The binding is schemeful: `http://www.namecheap.com` and
`https://www.namecheap.com` are different sites, so a scheme change answers
`OtherSite`. This differs from `nook-core`'s credential matching, which
compares registrable domains without the scheme. `nook-core` owns that PSL
policy but depends on this crate, so the same pinned `psl` crate is used here
under the schemeful rule.

## Bounds

Requests exceeding a bound fail decoding (`JsError`):

| Value | Bound |
|---|---|
| sender origin | 512 bytes |
| login reference | 1,024 bytes |
| messages | ≤ 6, text ≤ 300 characters |
| message tokens, ancestor tokens | ≤ 12 each, each token ≤ 48 characters |
| control labels | ≤ 64, existing login-save label bound |
| colour channels | 0–255 |
| links | ≤ 8, text ≤ 80 characters, href ≤ 300 characters |

Submit baselines use the same message bounds. Stored records are limited to
8 KiB and are rejected as `RecordRejected`.

## Security invariants

- Requests and the record carry no credential, password, or field value that
  Nook collected.
- The only page text in a record is the bounded site message of a failure.
  Because it is the site's own text, it may include what the site displays,
  such as an email address. It is protected by:
  - trusted-context-only `chrome.storage.session` storage;
  - never being logged;
  - removal when the attempt is resolved or the tab closes;
  - display only to its exact capture origin (other same-site origins,
    including the beginning origin when it differs, see the failure without it).
- Nothing in the lifecycle logs; error messages are fixed text.
- Every request is bound to its tab and the top-level frame. The sender
  origin comes from browser sender metadata, never from the message body.
- A record from another site in the same tab is never presented or advanced.
- Reset links are revalidated against the record's site at click time.
- Content scripts never read `chrome.storage.session`. Its access level stays
  `TRUSTED_CONTEXTS`.

## Tests

The tests are colocated Rust unit tests in the `sign_in_attempt` modules.
They drive the public `begin`/`advance` API through typed fixtures and cover:

- failure after reload, kept across further reloads;
- the Namecheap plain lock banner as `AccountLocked`, with and without a reset
  link;
- in-place wrong password and rate limit;
- `Unknown` for unclear text, and stale same-document banners;
- one-time-code and verification challenges;
- success after navigation with stability, and the success marker;
- a same-route spinner that never confirms, a new same-route sign-out
  affordance that confirms, an affordance already present at submit that
  does not count, and a same-document route change that confirms after
  stability;
- an SPA retry whose changed banner fails with its reason, and an unchanged
  banner that times out;
- concluded Failed, TimedOut, and ChallengeRequired records that stay while
  the login workflow is shown and close as `WorkflowLeft` once it is left;
- ancestor tokens that cannot veto a styled banner;
- reset offers re-derived from page evidence on a reloaded failure;
- step progression on the same and on a new document;
- unexplained re-presentation and timeout;
- in-flight and concluded dismissal, Try again, Choose another login, and
  reset-link revalidation;
- `OtherSite`, `RecordRejected`, and request bounds.

The generated-package ABI test belongs to the existing TypeScript consumer
path (`nook-web-app/tests/unit/lib/*-wasm-abi.test.ts`).
