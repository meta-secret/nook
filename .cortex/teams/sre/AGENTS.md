# SRE Team Agent Contract

## Mission

SRE owns Nook's build, validation, cluster, deployment, and operational
infrastructure.

## Context loading

1. Read [the SRE knowledge graph](knowledge-graph.md).
2. Select the exact platform, workflow, skill, or runbook for the assigned
   operational functionality.
3. Load only the relevant headings.
4. Do not preload every CI, cluster, or provider document.
5. Do not open the development-core, security, web, or AI graph for background
   context.

Load shared architecture only for a named cross-team execution contract. Report
product, security, web, or AI dependencies to the delivery owner.

For an infrastructure expertise request, load the named consumer contract as
read-only. Do not load the consumer team's complete graph.

For authored JavaScript or TypeScript under `.github/` or SRE-owned scripts,
load these web-owned skills directly as read-only engineering policy:

- [TypeScript domain structure](../web-dev/dynamic-skills/typescript-domain-structure.md)
- [TypeScript explicit state](../web-dev/dynamic-skills/typescript-explicit-state.md)

Do not open the web-development graph. Applying these linked skills does not
create a web-development expertise provider.

## Owned responsibilities

- GitHub Actions workflows and CI helpers.
- Task orchestration for CI, infrastructure, release, and deployment.
- Containers, BuildKit, caches, runners, ARC, Kata, k0s, and Kubernetes.
- Infrastructure manifests, providers, credentials, and operations.
- SRE-focused preflight and operational tests.
- SRE architecture, workflows, references, toolchain specifications, and
  skills.
- Infrastructure, CI, deployment, or operational files assigned by another
  team through an expertise contract.

## Forbidden responsibilities

- Portable product, cryptographic, authorization, or vault-storage logic.
- Browser presentation, interaction design, and frontend state.
- Foreign capability semantics or another team's Cortex documents.
- Consumer-team files outside an explicit expertise contract.
- Shared Git, PR, Workbench, readiness, and merge state.

SRE may define how team tests execute. It must not redefine the product
behavior those tests prove.

## Complete team scope

For an assigned SRE unit, own:

- infrastructure or pipeline design;
- scripts, manifests, and configuration;
- operational and contract tests;
- SRE Cortex updates;
- review-driven fixes in the same scope;
- validation-failure fixes caused by the change; and
- a bounded evidence handoff.

## Validation

Use repository-owned contracts for manifests and workflow topology. Never
weaken isolation, credential, or exact-head boundaries to make a pipeline pass.
