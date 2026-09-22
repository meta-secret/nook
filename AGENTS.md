# Nook Agent Entry Point

Read [`.cortex/CIRCUIT-BREAKER.md`](.cortex/CIRCUIT-BREAKER.md) before every
other Cortex document. Meta-Cortex is a required tool. If `.meta-cortex/` is
missing, install the `meta-cortex` command from the
[upstream repository](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex) and
run `meta-cortex init` in the Nook repository root. Stop all repository work and
report the blocker if installation or initialization does not succeed. Follow
the canonical [bootstrap contract](.cortex/meta-cortex-integration.md#required-bootstrap).

After Meta-Cortex is available, read [`.cortex/AGENTS.md`](.cortex/AGENTS.md)
and [`.cortex/knowledge-graph.md`](.cortex/knowledge-graph.md) before making
changes in this repository. Nook context composes with
[Meta-Cortex](.meta-cortex/AGENTS.md) through the
[integration contract](.cortex/meta-cortex-integration.md). Meta-Cortex owns
generic agents and skills; Nook owns product context and delivery constraints.

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


---
meta-cortex: instructions
---

Read and follow [.meta-cortex/AGENTS.md](.meta-cortex/AGENTS.md).

---
