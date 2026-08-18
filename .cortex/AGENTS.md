# Nook Agent Map & Operating Contract

## Overview

This is the system of record and entry point for all AI agents working in the Nook monorepo.
Consult [`.cortex/knowledge-graph.md`](knowledge-graph.md) for the universal knowledge graph, topic index, and exact section anchors across all specifications, architecture documents, dynamic skills, and workflows.

## How to search and navigate the Knowledge Graph

All specifications, architectural contracts, domain models, testing policies, dynamic skills, workflows, references, and execution plans are mapped in [`.cortex/knowledge-graph.md`](knowledge-graph.md).

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

### 2. Proactively enrich Cortex with critical discovered knowledge
- Dynamically evaluate new knowledge gained during tasks (tool failures, invariants, testing contracts, architecture rules).
- If critical knowledge is missing from Cortex, update Cortex and `knowledge-graph.md` in the same PR.
- See [dynamic-skills/cortex-consistency.md](dynamic-skills/cortex-consistency.md).

### 3. Keep cognitive complexity low in Cortex
- Use short sentences, bullet points, and lists (1 idea per sentence).
- Prohibit static project directory trees (use dynamic discovery tools) and ASCII graphics (use Mermaid).
- See [dynamic-skills/cortex-writer.md](dynamic-skills/cortex-writer.md).

### 4. Expose semantic structure in Cortex articles
- Expose clear explanation, rule, procedure, and reference hierarchies using semantic headings and lists.
- See [dynamic-skills/cortex-article-structure.md](dynamic-skills/cortex-article-structure.md).

### 5. Keep documentation consistent (Garbage Collection)
- Treat Cortex as maintained knowledge; garbage-collect obsolete claims and resolve cross-document conflicts immediately.
- See [dynamic-skills/cortex-consistency.md](dynamic-skills/cortex-consistency.md).

### 6. Keep the root README synchronized
- Update the root [`README.md`](../README.md) in the same PR whenever boundaries, package layout, or public commands change.

---

## ⛔ Agent Execution & Safety Boundaries

- **Feature ownership boundary:** Every agent stays strictly inside its assigned feature and focused issue set; another active agent's work is read-only. See [dynamic-skills/agent-feature-ownership.md](dynamic-skills/agent-feature-ownership.md).
- **Source file size limit (1,000 lines):** Every authored file, including Rust, stays at or below 1,000 lines. Oversized Rust signals excessive domain responsibility and requires cohesive domain or architectural decomposition; extracting unit tests alone is prohibited while integration tests remain separate. See [dynamic-skills/source-file-size.md](dynamic-skills/source-file-size.md).
- **Format on host before every push:** Always run `task loom:pre-push` before pushing to apply host formatting and check the UI demo contract. See [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md).
- **Heavy work runs remotely on GitHub Actions:** Heavy builds, tests, and product gates run on GitHub-hosted workers, not locally. See [dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md) and [workflows/remote-execution.md](workflows/remote-execution.md).
- **Container harness safety:** Never stop, restart, or kill the Docker daemon (`dockerd`, Docker VM); prohibit Dockerfile `RUN --mount=type=cache`. See [dynamic-skills/docker-container-harness.md](dynamic-skills/docker-container-harness.md).
- **Consult app logs when debugging:** Always inspect persisted application logs (`nook-app-logs.json`, `/logs`) when debugging e2e, UI, or CI failures before modifying code. See [references/logging.md](references/logging.md).
- **Fix check findings immediately:** Fix all static analysis, Knip, and jscpd findings in the same task; do not silence them or raise thresholds. See [workflows/quality.md](workflows/quality.md).

---

## ⛔ Autonomous Delivery Loop

Implementation agents follow [workflows/coding-bro.md](workflows/coding-bro.md) from start to finish:

1. **Branch & plan:** Fetch `origin/main`, branch, and publish the task plan to Workbench. Target <= 5,000 authored changed lines per PR.
2. **Implement:** Write focused code applying canonical dynamic skills and architecture package boundaries.
3. **Pre-push format:** Run `task loom:pre-push` to apply host formatting.
4. **Commit & push:** Commit formatted changes and push to the feature branch.
5. **Remote validation & review:** Run advisory local review before the first owner push; run complete PR validation and exact-head Cloud review via `task pr:validate`.
6. **Address all feedback:** Inspect and resolve all active review comments from humans or automated systems.
7. **Squash merge:** Once `task pr:ready` succeeds, squash-merge automatically (`gh pr merge --squash`).
8. **Publish Workbench records:** Update the Workbench issue, add the completion worklog, and publish `stats/ai-agent/<pr>.yaml`.

---

## Canonical Registries

- **Dynamic Skills Registry:** [dynamic-skills/index.md](dynamic-skills/index.md) (executable rules for Rust, TypeScript, Svelte, Testing, UI Design, and Code Hygiene).
- **Architecture Specifications:** [ARCHITECTURE.md](ARCHITECTURE.md) and [architecture/packages.md](architecture/packages.md).
- **Workflow Procedures:** [workflows/coding-bro.md](workflows/coding-bro.md), [workflows/pull-requests.md](workflows/pull-requests.md), and [workflows/remote-execution.md](workflows/remote-execution.md).
- **Design Documents:** [design-docs/index.md](design-docs/index.md).
- **Central Knowledge Graph:** [knowledge-graph.md](knowledge-graph.md).
