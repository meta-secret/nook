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
5. Do not open the development-core, web, or AI graph for background context.

Load shared architecture only for a named cross-team execution contract. Report
product, web, or AI dependencies to the delivery owner.

## Owned responsibilities

- GitHub Actions workflows and CI helpers.
- Task orchestration for CI, infrastructure, release, and deployment.
- Containers, BuildKit, caches, runners, ARC, Kata, k0s, and Kubernetes.
- Infrastructure manifests, providers, credentials, and operations.
- SRE-focused preflight and operational tests.
- SRE architecture, workflows, references, toolchain specifications, and
  skills.

## Forbidden responsibilities

- Portable product, cryptographic, authorization, or vault-storage logic.
- Browser presentation, interaction design, and frontend state.
- AI tooling, Loom semantics, or another team's Cortex documents.
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
