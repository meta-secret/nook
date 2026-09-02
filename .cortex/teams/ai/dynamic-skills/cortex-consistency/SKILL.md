---
name: cortex-consistency
description: Compile typed Cortex policy contracts and audit documentation consistency.
---

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
- a native harness workflow names a repository journal or retired CLI;
- a workflow omits the active runtime entrypoint required by its contract;
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
8. Update the owning root or team knowledge graph when document ownership,
   path, or discoverability changes. Update direct heading links when their
   target heading changes.

Verification checklist:

- [ ] Docs agree with each other on the active rule.
- [ ] Docs agree with the current code paths.
- [ ] Product specs reflect implemented features, user flows, and chat decisions.
- [ ] Named commands, packages, and paths still exist.
- [ ] Superseded designs are labeled historical.
- [ ] Dead links and orphan index rows are gone.
- [ ] New prose follows [cortex-writer.md](../cortex-writer.md).

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

1. Follow
   [subagent delegation](../../../../gizmo/workflows/subagent-delegation.md).
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
- [ ] Apply [cortex-writer.md](../cortex-writer.md) to every edit.
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
task remote TASK_NAME=loom:verify
```

- For density findings, set `includeDensityLint: true` in the cortexAudit
  request.
- See [Loom tools](../../references/loom-tools.md).
- Loom checks broken relative links, skill-index sync, and prohibited tracked
  harness skill mirrors.
- Semantic conflicts still require agent judgment.

- For implementation tasks:
  1. run required formatters and commit every allowed AI source or Cortex
     mutation in the coherent handoff;
  2. have Gizmo continue from the direct Team Agent commit and run
     `task loom:pre-push`;
  3. return any new formatter mutation in AI-owned content for a fresh AI
     commit before Gizmo reruns hygiene and pushes; and
  4. Gizmo dispatches at least one relevant focused remote task when the pushed
     head is not validation-ready, or complete exact-head validation immediately
     when it is ready.
- Gizmo obtains fresh exact-head remote evidence after every replacement push.

For a full Cortex GC request, report:

- obsolete facts removed or rewritten;
- cross-doc conflicts resolved;
- code mismatches fixed;
- remaining historical labels.

### Deterministic contract compilation

The ownership boundary is explicit:

- This skill's co-located TypeScript application owns the contract types,
  registry, ownership mapping, policy checks, and deterministic verification.
- Loom only discovers repository Markdown and adapts parsed references into the
  skill request.
- Loom also adapts commands from inline and fenced code as inert facts.
- Markdown does not become executable state.
- The rules and their executable policy remain beside this procedure.

Run the compiler through the normal Cortex consistency command:

```bash
task remote TASK_NAME=loom:verify
```

The command reports failures in `contractFindings`.

The co-located application is also a discoverable executable skill:

```bash
task skills:tools-list
task skills:run REQUEST_YAML='<cortexConsistency.compile request>'
```

The executable request contains parsed document paths and references. The
registry and policy semantics remain internal to this skill.

Request contract v2 adds the required `commands` collection to each document.
The former `cortex-consistency-compile-v1` transport is not accepted; callers
must regenerate the request through the current Loom Markdown adapter.

- Context ownership and policy applicability determine required policy imports.
- Authority and policy document paths are their contract identities.
- The registry does not repeat owner names beside those paths.
- Recognized authority paths determine context and policy ownership.
- A registered contract path without a recognized owner fails the audit.
- A foreign policy import requires a direct reference from the context authority.
- Direct references use Markdown syntax-tree semantics.
- Persisted-representation policy requires a schema-versioning authority.
- It also requires a legacy-decode or migration-test obligation.
- One policy discriminator selects the persisted contract and its obligations.
- Missing imports, references, authorities, or evidence obligations fail the
  Cortex audit.
- Registered workflow runtime bindings are closed policy.
- A missing required entrypoint fails the audit.
- An unregistered Task or Loom command fails the owning workflow audit.
- A retired entrypoint fails even when legacy implementation remains present.
- Native Team Agent workflows cannot bind repository journals as dispatch.

The registry covers only relationships promoted into its closed TypeScript
model. It does not infer meaning from Markdown or replace semantic review.
