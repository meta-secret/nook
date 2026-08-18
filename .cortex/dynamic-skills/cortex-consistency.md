# Cortex Consistency — Garbage Collector

## Priority

This is a P1 documentation integrity rule:

- stale `.cortex` guidance is a defect;
- conflicting `.cortex` guidance is a defect; and
- `.cortex` guidance that disagrees with the code is a defect.

## Purpose

Treat `.cortex` as a living knowledge base that must stay true.

Agents act as a garbage collector for obsolete cortex facts.

Verification happens in the same task that touches the topic.

## Problem Pattern

Docs drift after code changes.

Common failures:

- a workflow names a Task command that no longer exists;
- two `.cortex` docs state opposite rules for the same topic;
- a product spec omits features or rules introduced in chat, code, or PR reviews;
- a design doc describes an old architecture after the code moved;
- an index still links a deleted or renamed file;
- a skill card teaches a pattern the repo already rejected;
- historical context is written as if it were current policy.

## Preferred Pattern

When a task touches durable behavior, verify the related cortex surface.

1. Find the most specific `.cortex` docs for the topic.
2. Compare those docs with each other.
3. Compare those docs with the current code and Task entrypoints.
4. If newly discovered critical facts are missing, add them to Cortex.
5. Fix obsolete facts in the same PR.
6. Mark historical context as historical when it must remain.
7. Remove or rewrite guidance that conflicts.
8. Update `.cortex/knowledge-graph.md` and `AGENTS.md` links when headings or paths change.

Verification checklist:

- [ ] Docs agree with each other on the active rule.
- [ ] Docs agree with the current code paths.
- [ ] Product specs reflect implemented features, user flows, and chat decisions.
- [ ] Named commands, packages, and paths still exist.
- [ ] Superseded designs are labeled historical.
- [ ] Dead links and orphan index rows are gone.
- [ ] New prose follows [cortex-writer.md](cortex-writer.md).

Conflict resolution order:

1. Current code and enforced checks win over prose.
2. The most specific active `.cortex` doc wins over a general summary.
3. `AGENTS.md` must point to the winning doc.
4. Older conflicting prose must be updated, labeled historical, or removed.

## Scope

Applies to:

- every `.cortex/**/*.md` edit, including product specifications
- implementation tasks that change durable architecture, workflow, or product
  behavior
- skill-card capture and refactor work
- explicit user requests to audit or clean `.cortex`

Default task scope:

- verify the docs that own the changed topic;
- follow links one hop from those docs;
- do not rewrite the entire `.cortex` tree unless the user asks for a full GC.

A full-tree GC follows this ownership model:

1. Follow [subagent-delegation.md](../workflows/subagent-delegation.md).
2. When multiple document families are in scope, delegate read-only evidence
   collection by family.
3. Keep one task owner responsible for conflict resolution and the final edit.

Does not apply to:

- chat-only scratch notes outside `.cortex`
- Workbench task status records
- intentional historical archives that are clearly labeled historical
- secrets, credentials, or private runtime data

## Examples

Before:

- One paragraph says same-repository PR jobs write SeaweedFS objects.
- Another paragraph in the same file says PR jobs bypass sccache.
- The Docker/Task code mounts writer credentials for same-repository PR jobs.

After:

- Keep the writer-identity rule that matches the code.
- Fix the stale bypass claim in the same PR.
- Leave a short historical note only if old behavior still matters.

Before:

- A design doc describes scalar vault sync as current.
- Event-log sync is the implemented path.

After:

- Label the scalar-sync doc historical, or point it to the event-log doc.
- Make indexes and `AGENTS.md` point at the active design.

## Application Checklist

- [ ] Identify the durable topic touched by the task.
- [ ] Open the owning `.cortex` docs and nearby index links.
- [ ] Diff claims against code, Taskfiles, and CI workflows.
- [ ] Resolve conflicts with the resolution order above.
- [ ] Apply [cortex-writer.md](cortex-writer.md) to every edit.
- [ ] Update indexes when files move, split, or become historical.

## Validation

- The proof is a docs diff that restores agreement.
- Name the checked docs and the code or Task paths used as evidence.

Run the mechanical link and index audit:

Request:

```yaml
cortexAudit:
  includeDensityLint: false
```

```bash
task loom:cortex-audit
```

- For density findings, set `includeDensityLint: true` in the cortexAudit
  request.
- See [Loom tools](../references/loom-tools.md).
- Loom checks broken relative links, skill-index sync, and executable skill
  paths.
- Semantic conflicts still require agent judgment.
- For implementation tasks:
  1. run `task loom:pre-push`;
  2. commit and push; and
  3. use the normal hosted validation path.

For a full Cortex GC request, report:

- obsolete facts removed or rewritten;
- cross-doc conflicts resolved;
- code mismatches fixed;
- remaining historical labels.
