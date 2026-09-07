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
- `CompanionExtensionProtocol` owns discovery and unlock classification.
- The protocol owns request correlation and one-use nonce consumption.
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

- `NookCompanionExtensionEndpoint` authorizes and seals through the same Rust
  operation.
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
- It transports generated request and response DTOs.
- It invokes the Rust endpoint selected by the browser event.

TypeScript must not classify companion state, correlate requests, validate
payloads, authorize handoffs, or choose portable workflow outcomes.

## Execution modes

### Direct Rust composition

Rust tests create real website and extension objects.
They call one endpoint with the other endpoint's typed result.

There is no serialized browser hop in this mode.
The compiler verifies every relationship between the two sides.
The test still exercises the production protocol types and endpoint behavior.

The first framework slice proves this shape with real `NookVaultManager`
instances and a real `NookCompanionExtensionEndpoint`.
It also tests the portable protocol independently.

### Independent WASM composition

The two generated WASM modules cannot exchange module-specific object handles.
Their common JavaScript seam is a Rust-derived structural DTO.

Protocol DTOs use `Tsify` for that seam.
Generated declarations remain the only TypeScript contract.
No authored TypeScript interface may duplicate the DTO.

An independent-WASM composition test is a follow-up deliverable.
It must load both generated modules and execute the production endpoint path.

### Browser delivery

Production browser channels are untrusted delivery mechanisms.
They do not gain application semantics.

An adapter decodes the incoming generated shape at the Rust boundary.
Rust rejects malformed, stale, mismatched, or replayed values.
The adapter returns the typed Rust result through the browser channel.

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
- Request and vault correlation are carried through the Rust workflow.
- A handoff context must name the requested vault.
- The expected installation app key must match the unlocked extension manager.
- Handoff authorization and sealing form one Rust-owned production operation.
- A handoff nonce is consumed once.
- Website completion consumes the retained request before accepting a response.
- Secret recipient material must not survive completion or rejection.
- Sentinel extension access remains unrepresentable.

## Sequential delivery

### Framework PR

The first PR establishes the typed Rust protocol and in-process composition.
It includes production endpoint objects and focused Rust tests.

It does not migrate browser adapters or claim end-to-end browser coverage.

### Adapter PR

The next PR migrates browser delivery to generated DTOs and Rust admission.
It removes TypeScript-owned companion decisions from the selected flow.
Chrome and window messaging remain thin transport implementations.

### Composition-test PR

The following PR loads both independently generated WASM artifacts.
It exercises authorize, seal, and finish through the exact production ABI.
It also adds reusable typed scenario builders for TypeScript tests.

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
- deferred adapter and scenario work is not represented as implemented.

Later PRs extend this evidence at the generated ABI and browser boundaries.
