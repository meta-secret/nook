# User-Facing Security Abstractions

## Purpose

Present security concepts at the level where a person can make a meaningful
decision. Keep implementation keys subordinate to the product object they
protect or identify.

## Problem pattern

A UI presents a cryptographic implementation object as a peer of the product
object a person recognizes.

Examples include:

- showing an app key beside a passkey as another user-managed key;
- giving an internal public-key identifier equal visual weight to an app;
- naming graph stages after storage or cryptographic types; and
- implying that two peer rows require independent user decisions when one is
  only the implementation of the other.

This creates a false hierarchy. It also exposes terminology that does not help
the person manage access.

## Preferred pattern

- Lead with the object or action a person recognizes.
- Show the protected app, device, or installation as subordinate context.
- Use product nouns in labels, graph nodes, metrics, and relationship copy.
- Put public identifiers and cryptographic metadata behind an explicit
  **Advanced** disclosure.
- Preserve the exact internal key model in Rust, WASM, storage, and developer
  diagnostics.
- Keep relationship claims evidence-based.
  - A local passkey may be shown as protecting its local app.
  - A remote app may be shown as linked to the identity.
  - Do not claim that the local passkey unlocks a remote app without verified
    evidence.

## Scope

Apply this rule to:

- identity and access inventories;
- security settings and onboarding;
- relationship graphs;
- recovery and device-management UI; and
- user-facing security copy.

Do not apply it to:

- Rust domain types;
- storage schemas;
- protocol messages;
- developer diagnostics; or
- a key that users can independently rotate, revoke, export, or authorize.

## Examples

Before:

- Passkey and App key appear as peer rows.
- The graph reads Passkey → App key → Identity.

After:

- Passkey is the managed row.
- Apps appear beneath it.
- The graph reads Passkey → App → Identity.
- App ID appears only in **Advanced**.

## Application procedure

1. Identify the user decision owned by the surface.
2. Separate product objects from implementation objects.
3. Build the visible hierarchy from product objects.
4. Move useful technical identifiers into progressive disclosure.
5. Preserve internal typed contracts and security checks.
6. Add rendered assertions for labels, hierarchy, and disclosure state.

## Validation

- The primary surface contains no peer implementation-key object.
- Product objects have truthful parent-child relationships.
- Advanced identifiers are hidden by default and remain non-secret.
- Accessible names use the same product abstraction as visible copy.
- Unit tests cover evidence-sensitive relationship labels.
- Focused Playwright coverage proves the rendered hierarchy.
