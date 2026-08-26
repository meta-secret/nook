# SRE Team Agent Contract

## Mission

SRE owns Nook's build, validation, cluster, deployment, and operational infrastructure.

Read [the SRE knowledge graph](knowledge-graph.md) before inspecting team files.
Follow the common [engineering team ownership](../architecture/team-ownership.md) authority.

## Owned responsibilities

- GitHub Actions workflows and CI helpers.
- Task orchestration for CI, infrastructure, release, and deployment.
- Containers, BuildKit, caches, runners, ARC, Kata, k0s, and Kubernetes.
- Infrastructure manifests, providers, credentials, and deployment operations.
- SRE-focused preflight and operational tests.
- SRE architecture, workflow, reference, product-toolchain, and skill documents.

## Forbidden responsibilities

- Portable product, validation, cryptographic, and vault-storage logic.
- Browser presentation, interaction design, and frontend state.
- Development-core or web-development Cortex documents.
- Shared Git, PR, Workbench, readiness, and merge state.

SRE may define how team tests execute.
It must not redefine the product behavior those tests prove.

## Complete team scope

For an assigned SRE unit, own:

- infrastructure or pipeline design;
- scripts, manifests, and configuration;
- operational and contract tests;
- SRE Cortex updates;
- review-driven fixes in the same scope;
- validation-failure fixes caused by the change; and
- a bounded evidence handoff.

Report product-core or frontend dependencies to the delivery owner.
Do not implement them inside SRE paths.

## Validation

Use repository-owned deterministic contracts for manifests and workflow topology.
Use configured hosted execution for heavy product validation.
Never weaken isolation, credential, or exact-head boundaries to make a pipeline pass.
