# Companion Protocol Simulation

## Decision

Companion communication is a Rust protocol with replaceable delivery edges.
Browser messaging is not the protocol.

The website and extension use the same Rust endpoints in every execution mode.
Unit tests connect those endpoints directly in one process.
Production adapters carry generated protocol values across browser channels.

This design rejects application mocks.
Tests construct real protocol and vault objects instead.
An external dependency may have a faithful simulation implementation when its
infrastructure behavior is outside the test's purpose.

## Goals

- Make browser-independent companion behavior compile-time dependent in Rust.
- Exercise website and extension WASM-owned behavior without a browser.
- Keep discovery, correlation, authorization, and handoff rules out of
  TypeScript.
- Give Rust tests direct access to real endpoint objects.
- Give TypeScript tests generated structural DTOs without local protocol
  mirrors.
- Reserve browser tests for browser integration risks.

## Ownership

### Portable protocol

`nook-companion-core` owns the portable companion contract.

- Rust DTOs define requests, observations, statuses, handoff contexts, and
  responses.
- Rust validation admits untrusted values.
- Status admission receives the discovery, returned status, and current
  observation time.
- Accepted admission returns a typed discovery transaction.
- The handoff request carries that transaction instead of reconstructing its
  correlation fields.
- `CompanionExtensionProtocol` owns discovery and unlock classification.
- `CompanionExtensionHandoffEndpoint` retains the discovery it issued.
- That endpoint consumes the discovery when it authorizes a handoff.
- `AuthorizedCompanionIdentityHandoff` is the capability produced by successful
  authorization.
- `CompanionIdentityHandoffSealer` connects that capability to a real sealing
  implementation.

The protocol does not import Chrome, DOM, storage, or network APIs.

### WASM endpoints

`nook-companion-wasm` exposes the size-sensitive extension protocol through
generated bindings.
Its exports accept and return Rust-derived types.

`nook-wasm` owns manager-backed website and extension endpoints.

- One `NookCompanionExtensionEndpoint` remains active from discovery through
  authorization and sealing.
- The endpoint authorizes and seals through the same Rust operation.
- Authorization revalidates the transaction against current time.
- Authorization also revalidates current unlocked presence.
- `NookVaultManager` begins a website handoff and retains its pending request.
- The manager consumes the exact pending request before finishing a handoff.
- Pending recipient secret material is cleared on success and failure.

The public protocol uses installation app-key terminology.
Historical device-named core types may remain behind the manager boundary while
their migration is unfinished.

### Browser adapters

TypeScript owns browser lifecycle only.

- It observes `window` and `chrome.runtime` events.
- It enforces sender and origin checks at the browser boundary.
- It supplies current time and current extension presence as observations.
- It transports generated request and response DTOs.
- It invokes the Rust endpoint selected by the browser event.
- Offscreen code retains and frees the extension endpoint.

TypeScript must not classify companion state, correlate requests, validate
payloads, authorize handoffs, or choose portable workflow outcomes.

## Execution modes

### Direct Rust composition

Direct composition preserves these properties:

- Rust tests create real website and extension objects.
- One endpoint receives the other endpoint's typed result.
- No serialized browser hop exists.
- The compiler verifies the relationship between both sides.
- Production protocol types and endpoint behavior remain under test.

The framework slice proves the shape with real `NookVaultManager` instances.
It also uses a real `NookCompanionExtensionEndpoint`.

The composition-test slice expands that native evidence:

- The portable matrix covers presence projection, malformed observations,
  expiry, correlation, capability scope, revocation, app-key mismatch, replay,
  and unlock correlation.
- The manager matrix covers successful handoff, pending-secret cleanup, failed
  sealing, nonce consumption, forged responses, and real app-key mismatch.

### Independent WASM composition

Independent composition preserves these properties:

- Module-specific object handles do not cross between WASM packages.
- A Rust-derived structural DTO is the common JavaScript seam.
- Protocol DTOs use `Tsify` for that seam.
- Generated declarations remain the only TypeScript contract.
- No authored TypeScript interface duplicates a DTO.

The composition-test slice adds this generated-package evidence:

- Both generated WASM packages initialize independently.
- Structural DTOs move directly between them.
- The flow executes discovery and website begin.
- It then executes extension authorization, sealing, response admission, and
  website finish.
- It exercises malformed input, correlation mismatch, app-key mismatch,
  replay, and a forged response.
- It does not use `window` or `chrome.runtime` messaging.

### Browser delivery

The adapter slice implements browser delivery for the identity handoff flow.
Browser channels remain untrusted delivery mechanisms.
They do not gain application semantics.

The selected flow has these boundaries:

- Website code sends a generated discovery DTO.
- Rust status admission binds the discovery and returned status at receipt time.
- The accepted transaction enters the website handoff request unchanged.
- The service worker observes current extension presence.
- Offscreen code delivers the authorization to the retained Rust endpoint.
- Rust consumes the issued discovery before it authorizes and seals.
- The typed response returns through the browser channel.

Rust rejects malformed, stale, mismatched, revoked, or replayed values.
The service worker and offscreen document own delivery and lifecycle only.

Browser tests remain responsible for manifest routing, sender identity, origin
checks, serialization delivery, and browser lifecycle behavior.

## Simulation rules

### Required actions

- Construct real domain values, protocols, endpoints, and managers.
- Connect Rust endpoints through direct calls when transport is irrelevant.
- Exercise the same public operation used by production.
- Represent external infrastructure through a narrow behavior contract.
- Give an infrastructure simulation the same observable semantics needed by
  the application.
- Prefer deterministic in-memory state for storage or delivery simulations.
- Test success, rejection, replay, expiry, and correlation branches as typed
  outcomes.

### Prohibited actions

- Do not mock application objects or pre-program method expectations.
- Do not replace protocol behavior with call-count assertions.
- Do not add test-only branches to production application logic.
- Do not recreate protocol DTOs or validators in TypeScript fixtures.
- Do not treat a permissive fake as a simulation.
- Do not use browser E2E as a substitute for Rust behavior tests.

An infrastructure simulation is another implementation of a real boundary.
Its purpose is deterministic execution, not imitation by expectation.

## Security invariants

- Every external DTO is untrusted until Rust validation succeeds.
- Discovery expiry is checked against an explicit observation time.
- Status admission binds discovery, status, and admission time into one typed
  transaction.
- The handoff request carries that exact transaction.
- A handoff context must name the requested vault.
- Authorization rechecks expiry against its current observation time.
- Authorization rechecks current extension presence.
- The retained extension endpoint must own the matching issued discovery.
- The expected installation app key must match the unlocked extension manager.
- Handoff authorization and sealing form one Rust-owned production operation.
- Authorization atomically consumes the issued discovery before sealing.
- A rejected or ambiguous authorization cannot reuse that transaction.
- Website completion consumes the retained request before accepting a response.
- Secret recipient material must not survive completion or rejection.
- Sentinel extension access remains unrepresentable.

## Inert pairing activation preparation

This slice stops after Rust validates a prevalidated approval against typed event
records and produces an opaque prepared typestate. Preparation has no storage,
publication, acknowledgement, or live-reader effect and exposes no authority.

## Inert pairing activation candidate storage

The storage slice consumes preparation once. It revalidates the current manager,
approval expiry, sealed provider recipient and manifest, and both event DEK
envelopes immediately before effects. Decrypted keys live only in scoped
zeroizing Rust owners and never enter the candidate schema.

One Rexie transaction writes V1 event and sealed-provider payloads under the
`companion-pairing-activation:` prefix in the existing `nook_db` `vault` store.
The strict gate is written last. Replay, concurrent publication, late expiry,
unknown fields, unsupported versions, torn payloads, and digest mismatch fail
closed. Every failure after a payload write explicitly aborts the transaction.

The gate is only an integrity and publication marker inside mutable same-origin
storage. Opaque readback remains inert and no authoritative reader uses this
namespace. Later adoption owns external-root revalidation, `access_granted`,
final pairing state, acknowledgement, reader integration, reset, and migration.

## Sequential delivery

### Framework PR

The first PR establishes the typed Rust protocol and in-process composition.
It includes production endpoint objects and focused Rust tests.

It does not migrate browser adapters or claim end-to-end browser coverage.

### Composition-test PR

The second PR expands native scenario matrices around real protocol objects.
It also loads both independently generated WASM artifacts.

The generated test exercises the production endpoint ABI through structural
DTO delivery.
It does not introduce or migrate a browser transport.

### Adapter PR

The third PR implements browser delivery through generated DTOs and Rust
admission for the identity handoff flow.
It removes TypeScript-owned companion decisions from the selected flow.
Chrome and window messaging remain thin transport implementations.

The service worker supplies current presence and time as observations.
The offscreen document retains one endpoint across discovery and handoff.
Rust owns transaction admission, revalidation, authorization, and consumption.

### Workflow-migration PRs

Later focused PRs move remaining pairing, unlock, and event-log message behavior
into Rust endpoints.
Each PR removes the corresponding TypeScript schema and validator.
Each migration adds Rust scenario coverage before reducing browser E2E scope.

## Acceptance

The framework slice is complete when the repository proves these facts:

- the portable protocol compiles without browser dependencies;
- real endpoint objects compose through direct Rust calls;
- production handoff authorization and sealing share one Rust operation;
- replay and request mismatch fail closed;
- generated DTOs carry the cross-WASM contract; and
- deferred adapter work is not represented as implemented.

The composition-test slice adds these evidence obligations:

- native matrices exercise portable and manager-backed outcomes;
- both generated WASM packages initialize independently;
- their only connection is direct structural DTO delivery;
- the production authorize, seal, and finish ABI is exercised; and
- the composition remains independent of browser adapter behavior.

The adapter slice adds these evidence obligations:

- status admission binds discovery, status, and current time;
- the accepted transaction is carried through the handoff request;
- one extension endpoint spans discovery through authorization and sealing;
- authorization revalidates current time and current presence;
- transaction consumption is fail-closed and one-use; and
- browser and offscreen code own only delivery and lifecycle.

Pairing, unlock, and event-log message migrations remain deferred.
