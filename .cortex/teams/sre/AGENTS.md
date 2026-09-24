# SRE Team Agent Contract

This is a Nook functional context. The single Team Gizmo supplies it alongside
Meta-Cortex roles and skill composition. Generic upstream rules take precedence
over legacy generic wording here; Nook product and delivery requirements remain.


## Mission

### Delivery and validation

Apply the [dev delivery stages](../../gizmo-prime/architecture/dev-delivery.md).
Author meaningful tests in feature work, but execute them only in the feature
PR required-check stage. Feature validation is required PR-check execution only. Local
feedback is limited to scoped rustfmt and bounded inexpensive TS diagnostics
or formatting. Older instructions to run Loom tests, audits, preflight, or
broad pre-push commands are not local or feature-stage permissions.

### Infrastructure ownership

SRE owns Nook's build, validation, cluster, deployment, and operational
infrastructure.

Use the upstream [CI/CD agent](../../../.meta-cortex/teams/sre-team/agents/cicd-agent/AGENTS.md)
through the [provisioning adapter](provisioning/AGENTS.md) for assigned workflow
execution and pipeline repairs. Nook's commands, validation venue, provider
runbooks, and deployment authorization remain the execution contract.

- **Prohibited:** interpret green PR checks as authorization for a deployment.
- **Preferred:** run the separately authorized existing deployment procedure and
  return its actual revision and outcome to the feature owner.

## Nook context authorities

Follow Meta-Cortex [assignment context](../../../.meta-cortex/teams/AGENTS.md#assignment-context)
for generic context selection. The Nook [SRE graph](knowledge-graph.md)
catalogs the platform, workflow, skill, and runbook authorities used by this
context.

Load shared architecture only for a named cross-team execution contract. Report
product, security, web, or AI dependencies to the delivery owner.

For an infrastructure expertise request, load the named consumer contract as
read-only. Do not load the consumer team's complete graph.

For authored JavaScript or TypeScript under `.github/` or SRE-owned scripts,
load these web-owned skills directly as read-only engineering policy:

- [TypeScript domain structure](../../../.meta-cortex/teams/dev-team/agents/typescript-dev/skills/ts-dev-skill/practices/typescript-domain-structure.md)
- [TypeScript explicit state](../../../.meta-cortex/teams/dev-team/agents/typescript-dev/skills/ts-dev-skill/practices/typescript-explicit-state.md)

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

BuildKit owns Docker layer validity and reuse from the Dockerfile, build
context, build arguments, and base image presented to the solve. Treat custom
dependency fingerprints, cache selectors, or mutation simulations that
duplicate BuildKit's invalidation decision as a P1 finding and stop the work.
This prohibition does not remove cache import/export wiring, structured cache
artifacts, actual build and syntax checks, or sccache telemetry, health,
publication, and repeated changed-head zero-hit policy.
