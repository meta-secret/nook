# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who keep encrypted secrets in one or more Nook vaults and need to
understand, recover, and control how browsers, devices, passkeys, local
PIN/passphrases, and backup passwords grant access.

## Product Purpose

Nook is a local-first, end-to-end encrypted vault system. Success means a
person can use and synchronize independent vaults without surrendering
plaintext secrets or private device identities to Nook infrastructure, while
remaining able to understand exactly what can unlock each vault.

## Positioning

Nook separates vault access from storage replication. Browser-protected age
device identities and explicit per-vault authorization control decryption;
sync providers carry encrypted event data but do not become vault identities.

## Operating Context

Simple Vault and Sentinel are separate origin-isolated web applications that
share audited Rust/WASM and Svelte building blocks. A person may use several
vaults, several enrolled devices, passkey-PRF device protection, a local
PIN/passphrase fallback, per-vault backup passwords, and multiple encrypted
sync replicas.

## Capabilities and Constraints

- A passkey or local PIN/passphrase protects a browser-local age device
  identity; it is not itself a vault key.
- One device identity may be authorized for multiple independent vaults.
- Each vault owns independent encryption keys, enrolled-device relationships,
  backup passwords, and sync-provider configuration.
- Backup passwords open their owning vault directly and do not unlock the
  browser device identity.
- WebAuthn does not provide a general inventory of credentials held by external
  passkey providers and does not reliably disclose which provider the user
  selected. Nook must label observed, user-supplied, last-known, and unknown
  information honestly.
- Private device keys, vault keys, PIN/passphrases, passkey PRF output, and
  plaintext secrets never enter URLs, logs, analytics, or durable plaintext UI
  state.
- Simple, Sentinel, and the browser extension retain separate application and
  origin security boundaries.

## Brand Commitments

Nook product interfaces are calm, direct, technically honest, and available in
English and Russian. Security consequences stay next to the actions they
explain; uncertainty is stated rather than hidden behind reassuring copy.

## Evidence on Hand

The repository contains the shipping Simple and Sentinel vault applications,
typed Rust/WASM device-protection and vault-access domains, encrypted local
storage, passkey and PIN browser journeys, and Playwright demo/e2e fixtures.
Future work must not fabricate passkey-provider detection or security claims.

## Product Principles

- Show what protects what.
- Keep access authority separate from storage location.
- Prefer verified relationships and explicit provenance over inference.
- Make locked and recovery states useful without exposing secret material.
- Keep portable security policy in Rust and browser ceremony glue in the web
  layer.

## Accessibility & Inclusion

Security workflows must be keyboard accessible, screen-reader named, usable at
mobile widths and browser zoom, and understandable without color-only status.
English and Russian product copy remain semantically equivalent.
