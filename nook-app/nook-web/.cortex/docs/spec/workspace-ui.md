# Workspace UI rebuild

## Scope

The replacement Svelte UI starts with vault creation/unlock, items, and settings.
It uses the existing Rust/WASM application capabilities and the existing Svelte,
TypeScript, and Lucide libraries. This is a new screen tree; the former dashboard,
wizards, graph views, and research experiment catalog are retired.

Simple and Sentinel remain independent applications. Simple opens device-key or
backup-password vaults. Sentinel uses its existing participant genesis and quorum
unlock operations; it must never fall back to Simple or accept extension grants.
Local storage schemas, encryption, authorization, and domain validation do not change.

## Screens

- Access: explicit device authorization, local vault selection, create, and unlock.
  Passkey cancellation must not silently create a replacement identity or PIN.
  PIN setup is offered only after the existing Rust capability result allows it.
- Items: searchable, paged metadata list and one selected detail/editor pane.
  Six editable types are login, note, API key, seed phrase, authenticator, and card.
  Existing file attachments can be downloaded and passkey metadata inspected;
  creating these records remains outside this reduced editor.
- Settings: language, appearance, Simple backup-password entries, and confirmed
  deletion of local browser data.
- Extension: compact protection/pairing popup, login picker, authenticator picker,
  and explicit Simple consent. Protocol and content-script security stay unchanged.
- Research: one isolated fictional workspace study.

Provider configuration, import/export wizards, device administration, identity
inventory/recovery, graph views, and their navigation are not in this first smaller
interface. Their Rust and browser service APIs remain available for subsequent
screens. Public site and legal documents remain separate static artifacts.

## Lifetime and interaction requirements

List rows retain plain public metadata, not WASM page objects whose owner can free
them on mutation. Decrypted records load only after explicit reveal and are freed
when hidden or when their pane/session is destroyed. Editing and navigation must
not retain records across vault lock. Password drafts are transient. No secrets
are persisted or logged by presentation code.

Desktop uses a navigation rail, item list, and detail pane. Mobile presents the
list or detail at a time with an explicit Back action. All production copy comes
from the shared English/Russian catalogs. Rust supplies validation results and
localized domain errors. Deletion requires confirmation.

## Verification and retired UI tests

Replacement browser tests cover the smaller workspace's create/edit/search,
reveal/hide, lock/unlock, persistence, settings, and deletion flows. Isolated-build
tests continue to prove Rust rejects the opposite vault architecture and Sentinel
rejects extension routes. Component tests verify decrypted-record disposal and
late-response disposal. Existing Rust and browser service tests remain in place.

Browser scenarios tied to retired provider/import/administration screens and the
old research demos, including manual live-provider scenarios, are retired with those screens. They are not evidence for the
new UI; restoring any such feature requires a new browser scenario for its actual
replacement controls. External-site mock-auth fixtures remain test infrastructure.
