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

Update the owning team card, shared ownerless policy, or owning workflow.

### Project workflows

Project workflows describe repeatable repository procedures.

Examples include:

- release and deployment;
- migrations;
- test setup;
- pull-request delivery;
- incident handling.

Extend the existing `.cortex/teams/ai/workflows/` authority. Do not invent a competing
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

Before returning promotion and cleanup evidence to Gizmo, the AI team reads the
complete session file and answers:

1. What did I learn about the project?
2. What did I learn about agent work in this repository?
3. Which Cortex guidance was incomplete, misleading, duplicated, or stale?
4. What would materially help a future agent work faster or more safely?
5. Should an existing protocol change?
6. What should not be persisted?

The answers produce candidates. They do not automatically become permanent
documentation.

If review or CI produces another discovery after reflection, the AI team adds it
to the session file and repeats the review before returning evidence to Gizmo.

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

1. Search the root routing graph and the responsible team's knowledge graph.
2. Find the existing authority for the topic.
3. Update that authority when possible.
4. Create a new document only when no current document owns the knowledge.
5. Update the owning knowledge graph when headings, relationships, or
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

## User authority for major architectural initiatives

The user owns the initiative for a major architectural direction.

An agent must not turn its own reasoning into implementation authority when a
solution has one or more of these signals:

- It introduces a new subsystem, runtime, execution model, storage model,
  protocol, or security boundary.
- It changes ownership or dependency direction across several modules.
- It requires a multi-PR program, broad migration, or substantial operational
  commitment.
- It establishes a project pattern that is materially different from current
  architecture.
- Its complexity or risk is disproportionate to the problem the user asked to
  solve.

Before explicit user authorization, the agent may:

- investigate the problem read-only;
- explain why existing architecture may be insufficient;
- present bounded alternatives and tradeoffs;
- recommend the smallest viable direction; and
- ask the user to select a direction; and
- record proposal or blocker evidence without representing the direction as an
  accepted implementation initiative.

The agent must not begin implementation from that analysis alone.

- Do not create implementation code or an implementation branch.
- Do not change Cortex as though the proposed architecture were accepted.
- Do not mark an agent-created major direction as ready or in progress.
- Do not decompose the proposal into an agent-owned delivery program.

Workflow lifecycle records may preserve a proposal, explicit dispatch, or
authorization blocker. Those records are evidence. They do not authorize the
major direction.

Implementation becomes authorized only when the user has discussed the problem
and explicitly asks for the selected major solution to be implemented. A broad
request to improve, simplify, secure, or automate an area is not sufficient by
itself.

This rule does not remove normal implementation autonomy. After the user
selects the major direction, the agent may make bounded engineering decisions
inside that outcome. The gate also does not apply to ordinary fixes, tests,
documentation corrections, or refactors that preserve the accepted
architecture.

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
- **Deterministic leaf:** Move it to Loom, Task, or another typed tool.
  - Its output must follow entirely from declared inputs.
  - Do not create an agent task for a mechanical assertion.
- **Bounded semantic task:** Delegate it when the generic delegation criteria
  are satisfied.
  - Give each worker the same exact baseline.
  - Keep the worker read-only or give it an isolated disjoint write scope.
  - Define inputs, typed or structured output, acceptance evidence, and the
    parent-owned join before dispatch.
- **Compiled workflow candidate:** Consider it only when task identities,
  dependencies, parallel groups, joins, resources, timeouts, results, and
  terminal routes are stable.
- **Delivery-owner-only action:** Return shared-edit and synthesis evidence to
  Gizmo. Gizmo owns Workbench, GitHub, readiness, and merge.
- **Ephemeral instruction:** Reject it when it is task-specific, speculative,
  or insufficiently evidenced.

Follow [Subagent delegation](../../../gizmo/workflows/subagent-delegation.md) for the full
worker contract and safe parallelism rules.

### Loom extraction procedure

1. Find the owning workflow through the root or responsible team graph.
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
6. Move deterministic assertions into a typed leaf.
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
- Promote a processing discovery only after Gizmo validates it
  against code, tests, and the owning Cortex documents.

The audit may propose a graph. Gizmo reviews it and assigns accepted Cortex
changes to an AI team subagent.

Never parse Markdown, YAML, prompts, session notes, or model output into
executable topology. Never let a workflow rewrite its own compiled graph at
runtime.

The static graph boundary is defined in
[Agent workflow orchestration](../design-docs/agent-workflow-orchestration.md).
The existing `loom:agent-workflow:cortex-audit` SDK path is a legacy standalone
reviewed read-only workflow outside Gizmo multi-team admission. It cannot claim,
authorize, or execute the ordinary multi-team delegation contract.

## Task lifecycle

For every substantial task:

1. Select the team through the root graph and load relevant context through the
   owning team graph.
2. Create temporary session memory.
3. Investigate and plan.
4. Implement the bounded request.
5. Run only the focused AI or Cortex proof needed to evaluate the lessons. Do
   not add broad local product validation.
6. Capture meaningful discoveries throughout work, review, and CI.
7. Complete the self-improvement review.
8. Run the workflow improvement review when the evidence triggers it.
9. Promote only evidence-backed durable knowledge.
10. Synchronize skills, workflows, and the knowledge graph when their contracts
   changed.
11. Validate Cortex consistency and the updated documentation head.
12. Delete the session file.
13. Confirm no `.cortex/.session/` file is tracked.
14. Run required formatters and commit the clean promotion handoff. Include
    every resulting mutation in the AI team's allowed source or Cortex paths.
15. Return its exact commit, worker-focused proof, and cleanup evidence to
    Gizmo.
16. Gizmo integrates the handoff and performs minimal pre-push hygiene. If
    hygiene mutates AI-owned content, the AI team supplies a fresh formatted
    commit before Gizmo reintegrates, reruns hygiene, and pushes.
17. Gizmo owns exact-head remote validation, readiness, merge, or the requested
    handoff.

If promotion changes the pushed head, Gizmo promptly pushes the coherent
replacement and repeats complete exact-head hosted validation before
readiness.

## Pull-request completion contract

Before the AI team returns self-improvement evidence to Gizmo:

- [ ] Implementation is complete.
- [ ] Required worker-focused proof is complete on the committed handoff.
- [ ] Session discoveries were reviewed.
- [ ] Durable project knowledge was extracted when justified.
- [ ] Agent protocols or project workflows were improved when justified.
- [ ] The owning root or team knowledge graph was updated when required.
- [ ] Cortex consistency was validated.
- [ ] Temporary session memory was removed.
- [ ] No speculative or duplicate knowledge was promoted.
- [ ] The clean handoff is committed and its exact commit is reported.

This contract completes before final readiness and merge. Promotion therefore
enters the same pull request as the substantial work.

Hosted validation and readiness are not worker completion gates. After
integration, Gizmo runs minimal pre-push hygiene, promptly pushes the coherent
head, and obtains fresh exact-head remote evidence before readiness.

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

Before returning promotion and cleanup evidence to Gizmo:

1. Run the focused checks for every promoted Cortex authority.
2. Run required formatters. Include every resulting mutation in the AI team's
   allowed paths.
3. Run `task loom:cortex-audit` against the formatted promotion tree.
4. For a broad multi-family review, the legacy standalone reviewed read-only
   audit may run against the exact clean baseline:

   ```bash
   task loom:agent-workflow:cortex-audit BASELINE=<40-character-commit-sha>
   ```

   This command uses its own static scheduler and SDK path. It does not perform
   Gizmo admission, does not prove the ordinary multi-team contract, and must
   not be used for implementation delegation.

5. For a compiled workflow change, validate its dry run and focused behavior.
6. Commit the coherent audited promotion handoff. Do not push it. If any
   formatter changes the tree after step 3, rerun `task loom:cortex-audit`
   before committing.
7. Delete the local session file.
8. Run `task loom:cortex-session-clean`.
9. Confirm `git ls-files .cortex/.session` prints nothing.
10. Return the exact commit, worker-focused proof, promotion, and cleanup
   evidence to Gizmo.

Do not add broad local builds, tests, e2e, container product gates, or duplicate
hosted-check mirrors to this validation sequence.

Gizmo promptly pushes a coherent promoted head. If it is not validation-ready,
Gizmo immediately dispatches at least one relevant focused remote task. When
it is validation-ready, Gizmo immediately dispatches complete exact-head hosted
validation. Promotion that changes an already validated head requires complete
hosted validation again.
Gizmo then performs readiness, merge, or the requested handoff.
