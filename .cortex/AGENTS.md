# Nook Agent Map & Operating Contract

## Overview

This is the system of record for all AI agents working in the Nook monorepo.
It is also the agent entry point.

Consult [`.cortex/knowledge-graph.md`](knowledge-graph.md) for team routing.
Then use the selected team's knowledge graph for exact authority anchors.

## How to search and navigate the Knowledge Graph

The root graph routes to development core, SRE, web development, and common
cross-team authorities.

Agents must follow this navigation and search protocol:

1. **Select the responsible team:**
   - Read [Engineering team ownership](architecture/team-ownership.md).
   - Classify the requested functionality as development core, SRE, web
     development, or common integration.
   - Use targeted text search when the owner is not obvious.

2. **Search the selected knowledge graph:**
   - Development core uses [`.cortex/dev-core/knowledge-graph.md`](dev-core/knowledge-graph.md).
   - SRE uses [`.cortex/sre/knowledge-graph.md`](sre/knowledge-graph.md).
   - Web development uses [`.cortex/web-dev/knowledge-graph.md`](web-dev/knowledge-graph.md).
   - Common integration uses [`.cortex/knowledge-graph.md`](knowledge-graph.md).

3. **Retrieve exact anchors:**
   - Locate the owning document and section anchor in the selected graph.
   - Read only the relevant range.
   - Do not load unrelated team authorities.

4. **Verify navigation after authoring:**
   - Update the owning team graph when a team document changes.
   - Update the root graph for common documents or team entry points.
   - Run `task loom:cortex-audit` for links, anchors, team placement, skill
     registries, and complete heading coverage.

---

## ⛔ Core P1 Operating Invariants

### 1. Always consult the Knowledge Graph first

- Read [`.cortex/knowledge-graph.md`](knowledge-graph.md) before exploring files or starting implementation.
- Select one team graph before loading implementation context.
- Retrieve exact section anchors rather than guessing paths.
- See [dynamic-skills/cortex-document-map.md](dynamic-skills/cortex-document-map.md).

### 2. Route implementation through team ownership

- Classify functionality before assigning files.
- Delegate each independently bounded unit to its team agent when available.
- Keep every team agent inside its code and Cortex boundary.
- Let a team agent report dependencies on another team to the delivery owner.
- Require each team to own implementation, tests, Cortex updates, review fixes,
  and validation fixes for its scope.
- Keep shared files and lifecycle mutations in the parent-owned join.
- See [Engineering team ownership](architecture/team-ownership.md) and
  [Team-oriented development](workflows/team-oriented-development.md).

### 3. Curate critical discovered knowledge through session memory

- For substantial tasks, capture provisional discoveries under
  `.cortex/.session/`.
- Reflect after implementation and validation.
- Promote only evidence-backed, reusable knowledge into the existing Cortex
  authority.
- Delete temporary session memory before readiness or handoff.
- No Cortex promotion is valid when nothing durable was learned.
- See [dynamic-skills/self-improvement.md](dynamic-skills/self-improvement.md).

### 4. Keep cognitive complexity low in Cortex

- Use short sentences, bullet points, and lists (1 idea per sentence).
- Prohibit static project directory trees (use dynamic discovery tools) and ASCII graphics (use Mermaid).
- See [dynamic-skills/cortex-writer.md](dynamic-skills/cortex-writer.md).

### 5. Expose semantic structure in Cortex articles

- Expose clear explanation, rule, procedure, and reference hierarchies using semantic headings and lists.
- See [dynamic-skills/cortex-article-structure.md](dynamic-skills/cortex-article-structure.md).

- Do not author HTML in Cortex Markdown.
- This prohibition includes block tags, inline tags, and HTML comments.
- Use Markdown syntax for document structure.
- Use escaped text, inline code, or block code for literal HTML examples.
- Block code may use fenced or indented Markdown syntax.

### 6. Keep documentation consistent (Garbage Collection)

- Treat Cortex as maintained knowledge; garbage-collect obsolete claims and resolve cross-document conflicts immediately.
- See [dynamic-skills/cortex-consistency.md](dynamic-skills/cortex-consistency.md).

### 7. Keep the root README synchronized

- Update the root [`README.md`](../README.md) in the same PR whenever boundaries, package layout, or public commands change.

### 8. Product specifications must stay active and updated in the agent loop

- Find the owning specification through the selected team knowledge graph.
- Update specifications inside that team's Cortex directory in the same PR
  when implementation or review reveals durable product knowledge.
- Treat stale or missing product specifications as P1 documentation defects.
- See [dynamic-skills/product-spec-lifecycle.md](dynamic-skills/product-spec-lifecycle.md).

---

## ⛔ Agent Execution & Safety Boundaries

- **Team-agent boundary:** Every implementation unit has one team owner. Team
  agents stop at foreign ownership and report cross-team dependencies to the
  delivery owner. See
  [team-oriented development](workflows/team-oriented-development.md).
- **Harness-native subagent protocol:** Let the active Codex, Cursor, or other
  capable harness create and coordinate subagents. The repository owns task
  contracts, write scopes, isolated workspace rules, commit handoffs, and
  integration evidence. JSONL streams and Markdown summaries are optional
  human evidence. They never gate dispatch, continuation, retries, joins, or
  completion. See
  [workflows/subagent-delegation.md](workflows/subagent-delegation.md) and
  [the executable skill](../.agents/skills/subagent-delegation/SKILL.md).
- **Bounded agent hierarchy:** Declare parent lineage and a task-specific depth
  limit before delegation. The harness owns nested delegation and enforces the
  limit. Children cannot widen their assigned scope or acquire delivery
  authority.
- **Module-oriented development:** Plan feature contracts top-down and continue
  implementation bottom-up from accepted providers to their consumers. Route
  read-only expertise through
  [architecture/module-experts.md](architecture/module-experts.md) and follow
  [workflows/module-oriented-development.md](workflows/module-oriented-development.md).
- **Structural refactoring:** Route code and Cortex coherence audits through the
  two read-only structural experts. Use synthesis-only system coherence when
  both evidence streams need a shared join. The delivery owner applies every
  correction. See
  [architecture/refactoring-experts.md](architecture/refactoring-experts.md)
  and [workflows/structural-refactoring.md](workflows/structural-refactoring.md).
- **Feature ownership boundary:** Keep this rule: agents mutate only their owned feature.
  - Another active agent's work is read-only.
  - When ownership is missing or ambiguous, wait for an explicit user, owner, or orchestrator handoff.
  - See [dynamic-skills/agent-feature-ownership.md](dynamic-skills/agent-feature-ownership.md).
- **Source file size limit (1,000 lines):** Every authored file, including Rust, stays at or below 1,000 lines. Oversized Rust signals excessive domain responsibility and requires cohesive domain or architectural decomposition; extracting unit tests alone is prohibited while integration tests remain separate. See [dynamic-skills/source-file-size.md](dynamic-skills/source-file-size.md).
- **No Python (P1 hard rule):** Repository-authored code, scripts, tests, automation, dependency manifests, containers, and Taskfiles must not use Python. Use Bun/TypeScript for scripting and controllers, Rust for compiled domain or systems behavior, and Taskfiles for orchestration. There are no baselines or grandfathered exceptions. See [dynamic-skills/typescript-rust-automation-only.md](dynamic-skills/typescript-rust-automation-only.md).
- **Provider credentials persist automatically (P1 hard rule):** Use authenticated provider MCP first, then the official API or CLI. Use a browser only for authorization bootstrap or an unavailable capability. Automatically save every reusable credential under `~/.nook` with `0700` directories and `0600` files. Never place credential material in the repository or agent-visible publication surfaces. See [references/infrastructure-provider-operations.md](sre/references/infrastructure-provider-operations.md).
- **Format on host before every push:** Always run `task loom:pre-push` before pushing to apply host formatting and check the UI demo contract. See [dynamic-skills/pre-push-hygiene.md](sre/dynamic-skills/pre-push-hygiene.md).
- **Heavy work runs remotely on GitHub Actions:** Heavy builds and tests do not run locally. Trusted jobs use disposable ARC Pods. Build producers connect to a persistent node-local rootless BuildKit shard. Browser jobs use ordinary Pods on `nook-k0s-container`. GitHub-hosted runners are reserved for untrusted fork and Dependabot code. See [dynamic-skills/github-actions-only-validation.md](sre/dynamic-skills/github-actions-only-validation.md) and [workflows/remote-execution.md](sre/workflows/remote-execution.md).
- **Kubernetes-native cluster execution (P1 hard rule):** Never run Docker, Podman, DinD, or another nested container runtime inside k8s or k0s. Never mount a host runtime socket or issue container runtime lifecycle commands from a Pod. Run Playwright directly in a purpose-built Pod image, or install it directly in the Actions Pod when the cold-start cost is acceptable. BuildKit remains a build-only service and is never a workload runtime. Local-machine policy remains undecided. See [dynamic-skills/kubernetes-native-cluster-execution.md](sre/dynamic-skills/kubernetes-native-cluster-execution.md).
- **Container harness safety:** Never stop, restart, or kill the Docker daemon (`dockerd`, Docker VM); prohibit Dockerfile `RUN --mount=type=cache`. See [dynamic-skills/docker-container-harness.md](sre/dynamic-skills/docker-container-harness.md).
- **Consult app logs when debugging:** Always inspect persisted application logs (`nook-app-logs.json`, `/logs`) when debugging e2e, UI, or CI failures before modifying code. See [references/logging.md](references/logging.md).
- **Fix check findings immediately:** Fix all static analysis, Knip, and jscpd findings in the same task; do not silence them or raise thresholds. See [workflows/quality.md](sre/workflows/quality.md).

---

## ⛔ Autonomous Delivery Loop

Implementation agents follow [workflows/coding-bro.md](workflows/coding-bro.md) from start to finish:

1. **Branch & plan:** Fetch `origin/main`. Read owning product specs for product tasks. Publish the task plan and branch. Start [agent self-improvement](dynamic-skills/self-improvement.md) for substantial work. Target <= 3,000 authored changed lines per PR. At 2,500 lines, inventory logical domain changes and plan a stacked sequence before adding scope.
2. **Implement:** Route bounded units to their team agents. Each team updates
   its code, tests, and Cortex authorities. Serialize cross-team contracts and
   shared files through the delivery owner.
3. **Pre-push format:** Run `task loom:pre-push` to apply host formatting.
4. **Commit & push:** Commit formatted changes and push to the feature branch.
5. **Remote validation & review:** Run advisory local review before the first owner push; run complete PR validation and exact-head Cloud review via `task pr:validate`.
6. **Address all feedback:** Inspect and resolve all active review comments. Update code, tests, and product specifications when review comments refine product behavior.
7. **Reflect and curate:** Complete [agent self-improvement](dynamic-skills/self-improvement.md) before readiness.
8. **Squash merge:** Once the updated exact head passes `task pr:ready`, squash-merge automatically (`gh pr merge --squash`).
9. **Publish Workbench records:** Update the Workbench issue, add the completion worklog, and publish `stats/ai-agent/<pr>.yaml`.

---

## Canonical Registries

- [Subagent delegation](workflows/subagent-delegation.md) owns hierarchical
  worker boundaries, harness responsibilities, optional human evidence, and
  parent-owned integration.
- [Module expert registry](architecture/module-experts.md) owns named read-only
  expert routing, internal API scope, production coverage, and exclusions.
- [Structural refactoring expert registry](architecture/refactoring-experts.md)
  owns the two repository-reading refactoring roles and the synthesis-only
  system coherence role.

- **Dynamic Skills Registry:** [dynamic-skills/index.md](dynamic-skills/index.md) (executable rules for Rust, TypeScript, Svelte, Testing, UI Design, and Code Hygiene).
- **Product Specifications:** [product-specs/index.md](product-specs/index.md) (living specifications for user-facing features, item schemas, and UX workflows).
- **Architecture Specifications:** [ARCHITECTURE.md](ARCHITECTURE.md) and [architecture/packages.md](architecture/packages.md).
- **Technical References:** [references/index.md](references/index.md) (cheat sheets and runbooks for logging, WASM, Loom, Svelte, and debugging).
- **Workflow Procedures:** [workflows/coding-bro.md](workflows/coding-bro.md), [workflows/pull-requests.md](workflows/pull-requests.md), and [workflows/remote-execution.md](sre/workflows/remote-execution.md).
- **Design Documents:** [design-docs/index.md](design-docs/index.md).
- **Central Knowledge Graph:** [knowledge-graph.md](knowledge-graph.md).
- **Development Core Knowledge Graph:** [dev-core/knowledge-graph.md](dev-core/knowledge-graph.md).
- **SRE Knowledge Graph:** [sre/knowledge-graph.md](sre/knowledge-graph.md).
- **Web Development Knowledge Graph:** [web-dev/knowledge-graph.md](web-dev/knowledge-graph.md).
