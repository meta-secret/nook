# Nook Agent Entry Point

Read [`.cortex/AGENTS.md`](.cortex/AGENTS.md) before making changes in this
repository. It is the system of record for architecture, product context, rules,
and workflows.

## Review guidelines

- Treat violations of [`.cortex/AGENTS.md`](.cortex/AGENTS.md) or its linked
  architecture and workflow rules as P1 findings.
- Treat weakened cryptographic, authentication, authorization, device-identity,
  or vault-storage boundaries as P1 findings, including plaintext secret
  persistence or sensitive data in logs.
- Flag business or validation logic added to TypeScript/Svelte when it belongs
  in `nook-core` and should be exposed through the typed Rust/WASM boundary.
- Require behavior-focused Rust tests for changed domain logic and targeted web
  tests for changed user flows; do not accept e2e coverage as a substitute for
  domain tests.
- Flag authored TypeScript/Svelte `null`, visible inline English instead of the
  shared translation catalogs, and undocumented schema or storage migrations.
