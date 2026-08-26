# Nook Agent Map & Operating Contract

## Overview

This is the system of record for all AI agents working in the Nook monorepo.
It is also the agent entry point.

Consult [`.cortex/knowledge-graph.md`](knowledge-graph.md) for the universal
knowledge graph. It maps specifications, architecture documents, dynamic
skills, and workflows to exact section anchors.

## How to search and navigate the Knowledge Graph

All Cortex authorities are mapped in
[`.cortex/knowledge-graph.md`](knowledge-graph.md). The graph includes domain
models, testing policies, dynamic skills, workflows, and references.

Agents must follow this navigation and search protocol:

1. **Perform keyword and topic searches against the Knowledge Graph:**
   - Use `grep_search` or targeted text search within `.cortex/knowledge-graph.md` for topics, keywords, domain terms (such as `DEK`, `Sentinel`, `coverage`, `Loom`, `cache`).
   - The Knowledge Graph contains hierarchical category groupings, document titles, exact markdown section fragments (`#section-anchor`), and 1-line directional summaries for each section.

2. **Retrieve exact section anchors instead of reading full documents:**
   - Locate the owning document and exact section anchor from `knowledge-graph.md`.
   - Read only the relevant line range using `view_file` with `StartLine` and `EndLine`.
   - Avoid dumping 50k+ tokens of full design documents or specifications into context when only a single section or rule is needed.

3. **Verify anchor integrity when authoring:**
   - If an agent adds, renames, or restructures headings in any `.cortex/` document, update `knowledge-graph.md` in the same task.
   - Run `task loom:cortex-audit` to verify zero broken links, zero orphan rows, and complete heading coverage.

---

## ⛔ Core P1 Operating Invariants

### 1. Always consult the Knowledge Graph first

- Read [`.cortex/knowledge-graph.md`](knowledge-graph.md) before exploring files or starting implementation.
- Retrieve exact section anchors rather than reading whole files or guessing paths.
- See [dynamic-skills/cortex-document-map.md](dynamic-skills/cortex-document-map.md).

### 2. Curate critical discovered knowledge through session memory

- For substantial tasks, capture provisional discoveries under
  `.cortex/.session/`.
- Reflect after implementation and validation.
- Promote only evidence-backed, reusable knowledge into the existing Cortex
  authority.
- Delete temporary session memory before readiness or handoff.
- No Cortex promotion is valid when nothing durable was learned.
- See [dynamic-skills/self-improvement.md](dynamic-skills/self-improvement.md).

### 3. Keep cognitive complexity low in Cortex

- Use short sentences, bullet points, and lists (1 idea per sentence).
- Prohibit static project directory trees (use dynamic discovery tools) and ASCII graphics (use Mermaid).
- See [dynamic-skills/cortex-writer.md](dynamic-skills/cortex-writer.md).

### 4. Expose semantic structure in Cortex articles

- Expose clear explanation, rule, procedure, and reference hierarchies using semantic headings and lists.
- See [dynamic-skills/cortex-article-structure.md](dynamic-skills/cortex-article-structure.md).

- Do not author HTML in Cortex Markdown.
- This prohibition includes block tags, inline tags, and HTML comments.
- Use Markdown syntax for document structure.
- Use escaped text, inline code, or block code for literal HTML examples.
- Block code may use fenced or indented Markdown syntax.

### 5. Keep documentation consistent (Garbage Collection)

- Treat Cortex as maintained knowledge; garbage-collect obsolete claims and resolve cross-document conflicts immediately.
- See [dynamic-skills/cortex-consistency.md](dynamic-skills/cortex-consistency.md).

### 6. Keep the root README synchronized

- Update the root [`README.md`](../README.md) in the same PR whenever boundaries, package layout, or public commands change.

### 7. Product specifications must stay active and updated in the agent loop

- Read owning specifications in [`.cortex/product-specs/`](product-specs/) before planning or implementing user-facing features, item types, or UX flows.
- Update specifications in `.cortex/product-specs/` (or author new ones) in the same PR when chat dialogues, tasks, or PR reviews reveal new product knowledge.
- Treat stale or missing product specifications as P1 documentation defects.
- See [dynamic-skills/product-spec-lifecycle.md](dynamic-skills/product-spec-lifecycle.md).

---

## ⛔ Agent Execution & Safety Boundaries

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
- **Provider credentials persist automatically (P1 hard rule):** Use authenticated provider MCP first, then the official API or CLI. Use a browser only for authorization bootstrap or an unavailable capability. Automatically save every reusable credential under `~/.nook` with `0700` directories and `0600` files. Never place credential material in the repository or agent-visible publication surfaces. See [references/infrastructure-provider-operations.md](references/infrastructure-provider-operations.md).
- **Format on host before every push:** Always run `task loom:pre-push` before pushing to apply host formatting and check the UI demo contract. See [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md).
- **Heavy work runs remotely on GitHub Actions:** Heavy builds and tests do not run locally. Trusted jobs use disposable ARC Pods. Build producers connect to a persistent node-local rootless BuildKit shard. Browser jobs use ordinary Pods on `nook-k0s-container`. GitHub-hosted runners are reserved for untrusted fork and Dependabot code. See [dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md) and [workflows/remote-execution.md](workflows/remote-execution.md).
- **Kubernetes-native cluster execution (P1 hard rule):** Never run Docker, Podman, DinD, or another nested container runtime inside k8s or k0s. Never mount a host runtime socket or issue container runtime lifecycle commands from a Pod. Run Playwright directly in a purpose-built Pod image, or install it directly in the Actions Pod when the cold-start cost is acceptable. BuildKit remains a build-only service and is never a workload runtime. Local-machine policy remains undecided. See [dynamic-skills/kubernetes-native-cluster-execution.md](dynamic-skills/kubernetes-native-cluster-execution.md).
- **Container harness safety:** Never stop, restart, or kill the Docker daemon (`dockerd`, Docker VM); prohibit Dockerfile `RUN --mount=type=cache`. See [dynamic-skills/docker-container-harness.md](dynamic-skills/docker-container-harness.md).
- **Consult app logs when debugging:** Always inspect persisted application logs (`nook-app-logs.json`, `/logs`) when debugging e2e, UI, or CI failures before modifying code. See [references/logging.md](references/logging.md).
- **Fix check findings immediately:** Fix all static analysis, Knip, and jscpd findings in the same task; do not silence them or raise thresholds. See [workflows/quality.md](workflows/quality.md).

---

## ⛔ Autonomous Delivery Loop

Implementation agents follow [workflows/coding-bro.md](workflows/coding-bro.md) from start to finish:

1. **Branch & plan:** Fetch `origin/main`. Read owning product specs for product tasks. Publish the task plan and branch. Start [agent self-improvement](dynamic-skills/self-improvement.md) for substantial work. Target <= 3,000 authored changed lines per PR. At 2,500 lines, inventory logical domain changes and plan a stacked sequence before adding scope.
2. **Implement:** Write focused code using canonical dynamic skills. Update `.cortex/product-specs/` when new product knowledge is gained.
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
- **Workflow Procedures:** [workflows/coding-bro.md](workflows/coding-bro.md), [workflows/pull-requests.md](workflows/pull-requests.md), and [workflows/remote-execution.md](workflows/remote-execution.md).
- **Design Documents:** [design-docs/index.md](design-docs/index.md).
- **Central Knowledge Graph:** [knowledge-graph.md](knowledge-graph.md).
