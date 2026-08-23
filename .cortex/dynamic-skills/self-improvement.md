# Agent Self-Improvement

## Purpose

Turn substantial agent work into curated operational knowledge without turning
Cortex into a scratchpad.

The required loop is:

1. Work.
2. Observe.
3. Capture provisionally.
4. Reflect after the requested work is complete enough to evaluate.
5. Promote only durable knowledge.
6. Continue delivery on the updated exact head.

## Problem pattern

Immediate documentation capture mixes several kinds of information:

- task-specific state;
- unsupported hypotheses;
- command output;
- duplicated facts;
- durable architecture and workflow knowledge.

Writing all of it into Cortex creates noise. Writing none of it forces future
agents to repeat meaningful investigation.

## Memory boundaries

Keep these memory classes separate:

- **Working memory:** Temporary and noisy observations for the current task.
- **Project knowledge:** Durable facts about architecture, domains, invariants,
  dependencies, and design constraints.
- **Agent protocols:** Reusable rules for how agents investigate, decide,
  validate, document, and deliver work.
- **Project workflows:** Repeatable repository-specific procedures.

Working memory is never authoritative. Its location under `.cortex/` does not
promote it.

## Session memory

Create one temporary file for every substantial task:

```text
.cortex/.session/<task-id-or-short-description>.md
```

The repository ignores the entire `.cortex/.session/` directory.

The session file may contain:

- incomplete thoughts;
- hypotheses;
- discoveries;
- failed approaches;
- concise command results;
- contradictions in documentation;
- useful file and symbol references;
- candidate project or protocol improvements.

The session file must not contain:

- credentials;
- secrets;
- private user or vault data;
- raw environment dumps;
- large raw logs;
- authoritative claims without evidence.

Do not create session memory for trivial or question-only work. Examples include
a one-line edit, a simple translation, or a direct lookup with no repository
investigation.

## Capture rules

Record a discovery when forgetting it could increase future cost or risk.

Each useful discovery should name:

- what was observed;
- the evidence;
- why it may matter later;
- its candidate category.

Do not capture details that are obvious from nearby code and unlikely to change
a future decision.

## Knowledge classification

Classify every promotion candidate before editing persistent Cortex.

### Project knowledge

Project knowledge describes how the system works.

Examples include:

- architecture and subsystem responsibilities;
- domain rules and invariants;
- important data flow;
- non-obvious technical decisions;
- constraints with architectural meaning.

Update the most specific existing architecture, design, product, or reference
document.

### Agent protocols

Agent protocols describe how an agent should work.

Examples include:

- investigation and assumption-verification rules;
- review and pull-request behavior;
- knowledge-loading guidance;
- self-review and Cortex maintenance rules.

Update the owning card in `.cortex/dynamic-skills/` or the owning workflow.

### Project workflows

Project workflows describe repeatable repository procedures.

Examples include:

- release and deployment;
- migrations;
- test setup;
- pull-request delivery;
- incident handling.

Extend the existing `.cortex/workflows/` authority. Do not invent a competing
taxonomy.

### Ephemeral knowledge

Do not promote information that is:

- specific only to the current task;
- temporary or speculative;
- immediately stale;
- duplicated by an existing authority;
- obvious from local code;
- unsupported by sufficient evidence.

Ephemeral knowledge must die with the session file.

## Self-improvement review

Before final readiness, read the complete session file and answer:

1. What did I learn about the project?
2. What did I learn about agent work in this repository?
3. Which Cortex guidance was incomplete, misleading, duplicated, or stale?
4. What would materially help a future agent work faster or more safely?
5. Should an existing protocol change?
6. What should not be persisted?

The answers produce candidates. They do not automatically become permanent
documentation.

If review or CI produces another discovery after reflection, add it to the
session file and repeat the review before readiness.

## Promotion criteria

Promote a candidate when at least one condition is true:

- It affects future implementation decisions.
- It explains a non-obvious constraint.
- It required meaningful investigation.
- Forgetting it could cause a future mistake.
- It describes a repeatable workflow.
- It corrects inaccurate documentation.
- It improves future agent decisions.
- It avoids repeated repository exploration.

No Cortex update is a valid outcome. Never manufacture documentation changes to
satisfy this protocol.

## Evidence and consistency

Verify promoted knowledge against one or more authoritative sources:

- source code;
- behavior-focused tests;
- configuration;
- existing documentation;
- build or Task scripts;
- observed runtime behavior;
- repository history when history matters.

When evidence is weak or contradictory:

1. Investigate further.
2. Document uncertainty only when that uncertainty itself is durable.
3. Otherwise leave the candidate ephemeral.

Never turn a guess into an architectural rule.

Apply [Cortex consistency](cortex-consistency.md) to every promotion.

## Persistent update procedure

When a candidate qualifies for promotion:

1. Search `.cortex/knowledge-graph.md` and the relevant Cortex family.
2. Find the existing authority for the topic.
3. Update that authority when possible.
4. Create a new document only when no current document owns the knowledge.
5. Update `.cortex/knowledge-graph.md` when headings, relationships, or
   discoverability change.
6. Apply the writer, article-structure, and consistency rules.
7. Validate the updated exact head.

Prefer one strong canonical document over several overlapping notes.

## Protocol evolution safety

Apply the improvement loop to protocols themselves.

Change a protocol only when observed evidence shows:

- repeated mistakes;
- missing validation;
- poor context selection;
- unnecessary repeated work;
- a demonstrably safer or clearer workflow.

Protocol changes must be:

- small;
- generalizable;
- evidence-based;
- consistent with existing safeguards.

Do not add self-justifying rules. Do not weaken a safeguard merely because one
unusual task required an exception.

## Workflow improvement review

Use reflection to find repeated workflow policy that can become reliable
execution.

Run this review when session evidence reveals:

- duplicated workflow prose;
- repeated manual mechanical steps;
- recurring independent investigations;
- unclear ownership between Cortex, Task, and Loom; or
- workflow friction that increased delivery cost or risk.

Do not run a broad workflow audit for every substantial task. Keep a local
review to the touched workflow and its one-hop authorities. Use the compiled
Cortex full-garbage-collection workflow when two or more document families need
independent evidence.

### Instruction classification

Classify each candidate instruction before changing its owner.

- **Semantic policy or judgment:** Keep it in the owning Cortex authority.
  - Examples include tradeoffs, classification, architectural synthesis, and
    exception handling.
- **Deterministic mechanism:** Encode it in the owning skill capability, Loom,
  Task, CI, lint, or another typed tool according to its responsibility.
  - Its output must follow entirely from declared inputs.
  - Do not create an agent task for a mechanical assertion.
  - Keep semantic authority, rationale, scope, exceptions, and acceptance
    meaning in Cortex.
  - Keep scheduling, isolation, provenance, and replay mechanics in Loom.
- **Bounded semantic task:** Delegate it when the generic delegation criteria
  are satisfied.
  - Give each worker the same exact baseline.
  - Keep the worker read-only or give it an isolated disjoint write scope.
  - Define inputs, typed or structured output, acceptance evidence, and the
    parent-owned join before dispatch.
- **Compiled workflow candidate:** Consider it only when task identities,
  dependencies, parallel groups, joins, resources, timeouts, results, and
  terminal routes are stable.
- **Delivery-owner-only action:** Keep shared edits, synthesis, Workbench,
  GitHub, readiness, and merge with one task owner.
- **Ephemeral instruction:** Reject it when it is task-specific, speculative,
  or insufficiently evidenced.

Follow [Subagent delegation](../workflows/subagent-delegation.md) for the full
worker contract and safe parallelism rules.

### Loom extraction procedure

1. Find the owning workflow through `.cortex/knowledge-graph.md`.
2. Inspect its linked skill, Loom reference, Task entrypoint, tests, and current
   implementation evidence.
3. Search the existing Loom leaf tools and compiled workflow catalog before
   proposing new machinery.
4. Record duplicated steps and classify each instruction using the categories
   above.
5. Identify independent semantic lanes.
   - Parallelize only lanes with the same immutable baseline.
   - Require non-overlapping resources and independent acceptance evidence.
   - Define the join before dispatch.
6. Move deterministic assertions into the owning typed capability.
   - Use a skill package for repository-specific mechanics.
   - Use Loom for generic trust and orchestration mechanics.
   - Keep mandatory Task or CI registration independent of model skill
     selection.
7. Use bounded subagents for semantic evidence collection.
8. Promote a repeated stable graph only as a reviewed TypeScript catalog
   change.
   - Define fixed task IDs and dependency edges.
   - Define explicit parallel targets and joins.
   - Define read and write resource claims.
   - Define timeouts, result types, terminal routes, and skipped results.
9. Keep runtime inputs bounded to a reviewed catalog entry, an exact source
   commit, and declared scalar values.
10. Replace duplicated procedural prose with links to the canonical Cortex
    authority and Loom entrypoint.
11. Validate graph structure, dry-run projection, execution behavior, Cortex
    coherence, and the updated exact head.

Workflow processing views may inform reflection after their hashes and source
identity are verified.

They are execution evidence, not durable Cortex authority by themselves.

- `workflow/processing/` keeps run events and semantic projections through
  aggregation and handoff.
- `.cortex/.session/` keeps disposable task reflection memory.
- Promote a processing discovery only after the delivery owner validates it
  against code, tests, and the owning Cortex documents.

The audit may propose a graph. The delivery owner reviews and authors it.

Never parse Markdown, YAML, prompts, session notes, or model output into
executable topology. Never let a workflow rewrite its own compiled graph at
runtime.

The static graph boundary is defined in
[Agent workflow orchestration](../design-docs/agent-workflow-orchestration.md).

## Task lifecycle

For every substantial task:

1. Load relevant Cortex context through `.cortex/knowledge-graph.md`.
2. Create temporary session memory.
3. Investigate and plan.
4. Implement the bounded request.
5. Validate the implementation enough to evaluate the lessons.
6. Capture meaningful discoveries throughout work, review, and CI.
7. Complete the self-improvement review.
8. Run the workflow improvement review when the evidence triggers it.
9. Promote only evidence-backed durable knowledge.
10. Synchronize skills, workflows, and the knowledge graph when their contracts
   changed.
11. Validate Cortex consistency and the updated exact head.
12. Delete the session file.
13. Confirm no `.cortex/.session/` file is tracked.
14. Finish readiness, merge, or the requested handoff.

If promotion changes the pushed head, repeat exact-head validation before
readiness.

## Pull-request completion contract

Before a substantial PR is ready:

- [ ] Implementation is complete.
- [ ] Required validation is complete on the current head.
- [ ] Session discoveries were reviewed.
- [ ] Durable project knowledge was extracted when justified.
- [ ] Agent protocols or project workflows were improved when justified.
- [ ] `.cortex/knowledge-graph.md` was updated when required.
- [ ] Cortex consistency was validated.
- [ ] Temporary session memory was removed.
- [ ] No speculative or duplicate knowledge was promoted.

## Session template

```markdown
# Session Memory

## Task

Describe the current task.

## Initial Context

List relevant files, Cortex authorities, assumptions, and boundaries.

## Discoveries

### Discovery 1

What was discovered?

Evidence:

Why it might matter later:

Candidate category:

- project knowledge
- agent protocol
- project workflow
- ephemeral

## Failed Approaches

Record only failures that could prevent meaningful repeated work.

## Documentation Issues

Record stale, missing, misleading, duplicated, or contradictory guidance.

## Protocol Friction

Record workflow behavior that caused avoidable cost or risk.

## Workflow Improvement Candidates

For each candidate, record:

- the owning Markdown authority;
- the repeated instruction;
- its instruction classification;
- fixed inputs and outputs;
- dependencies and possible parallel lanes;
- resource claims;
- the proposed Loom leaf, compiled workflow, or retained prose;
- evidence and acceptance checks; and
- why a rejected candidate should remain prose or ephemeral.

## Self-Improvement Review

### Durable project knowledge

List promotion candidates and evidence.

### Protocol improvements

List generalizable changes and evidence.

### Knowledge that should remain ephemeral

List rejected candidates and why they should die with the session.

### Cortex files to update

List existing authorities first. Name new files only when no authority exists.
```

## Validation

Before final readiness:

1. Run the focused checks for every promoted Cortex authority.
2. Run `task loom:cortex-audit`.
3. For a broad multi-family review, run the compiled audit against the exact
   clean baseline:

   ```bash
   task loom:agent-workflow:cortex-audit BASELINE=<40-character-commit-sha>
   ```

4. For a compiled workflow change, validate its dry run and focused behavior.
5. Run `task loom:pre-push` before each push.
6. Delete the local session file.
7. Run `task loom:cortex-session-clean`.
8. Confirm `git ls-files .cortex/.session` prints nothing.
9. Repeat exact-head hosted validation when promotion changed the PR head.
