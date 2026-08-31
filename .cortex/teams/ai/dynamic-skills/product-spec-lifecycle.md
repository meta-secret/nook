# Product Specification Lifecycle

## Priority

This is a P1 documentation integrity rule:

- Stale product specifications are defects.
- Missing product specifications for implemented features are defects.
- Product specifications that disagree with user conversation decisions or code are defects.
- Implementing product features without consulting existing specifications is a workflow violation.

## Purpose

Keep product specifications in the responsible team's `product-specs/`
directory and in the active loop of every AI agent.

Product specifications are the living system of record for:

- user-facing features;
- data item types and schemas;
- authentication, authorization, and enrollment user flows;
- vault storage modes and UX interactions;
- business rules, constraints, and edge case behaviors.

AI agents must read specifications to understand requirements.

AI agents must update specifications whenever chat interactions, task execution, or PR reviews reveal new product knowledge.

## Problem Pattern

Product specifications drift out of the loop when agents treat them as write-only static documents:

- The user explains feature requirements or UX behaviors in chat, but the agent updates only code.
- The agent implements or refactors a feature without reading the owning specification.
- A PR review conversation refines product behavior or adds edge cases, but the spec remains unchanged.
- A new item type, vault flow, or authentication path is introduced without adding a specification.
- Sibling documents describe conflicting requirements for the same product feature.

## Preferred Pattern

Integrate product specifications into every phase of agent work.

### 1. Read specifications before implementation

Before planning or editing code for any product feature:

1. Select the responsible team through
   [Engineering team ownership](../../../gizmo/architecture/team-ownership.md).
2. Search that team's knowledge graph and the global [product catalog](../../../shared/product-specs/index.md).
3. Read the owning specification for the feature, item type, or workflow.
4. Understand existing invariants, user flows, and acceptance criteria.
5. Align the task plan with the specification before making changes.

### 2. Update specifications on new product knowledge

Capture durable product knowledge in the owning specification in the same PR:

- **Chat conversations:** When the user clarifies requirements, UX flows, constraints, or feature priorities.
- **Task execution & debugging:** When implementation reveals essential product rules, defaults, or edge cases.
- **Executable scenarios:** When behavior-focused Rust, WASM, or Playwright
  tests prove an intentional product rule that the owning specification does
  not yet explain.
- **PR iterations & review feedback:** When review comments alter acceptance criteria, validation rules, or item attributes.

If no specification exists for a new feature or item type:

1. Create the specification in the responsible team's `product-specs/` directory.
2. Follow [cortex-writer.md](cortex-writer.md) and
   [cortex-article-structure/SKILL.md](cortex-article-structure/SKILL.md).
3. Register the new specification in [`.cortex/shared/product-specs/index.md`](../../../shared/product-specs/index.md).
4. Update navigation entries in the owning team knowledge graph.

### 3. Maintain specification status and consistency

Keep specifications accurate and current:

- Mark status accurately in [`.cortex/shared/product-specs/index.md`](../../../shared/product-specs/index.md) (`Draft`, `Active`, `Implemented`, `Verified`, `Historical`).
- Garbage-collect obsolete product claims under [cortex-consistency](cortex-consistency/SKILL.md).
- Ensure code, tests, and specifications agree.

## Scope

Applies to:

- User-facing features in `nook-web`, Simple Vault, Sentinel, and browser extension.
- Vault item types, fields, and validation rules.
- Authentication, enrollment, device joining, and recovery user flows.
- Changes to feature requirements discussed in user chat or PR comments.
- All team-owned `product-specs/` files under `.cortex/teams/dev-core/`,
  `.cortex/teams/sre/`, and `.cortex/teams/web-dev/`.

Does not apply to:

- Internal refactors that do not change product behavior or user flows.
- Tooling, Docker, or CI infrastructure changes (documented in `ARCHITECTURE.md` or `workflows/`).
- Fleeting scratch notes, raw chat transcripts, or transient task status.

## Examples

Before:

- User explains in chat that secure notes must support search by custom tags.
- Agent adds the tag search in code and tests, then opens a PR.
- `.cortex/teams/dev-core/product-specs/secure-notes.md` is never updated and remains unaware of tag search.

After:

- User explains tag search requirements for secure notes in chat.
- Agent reads `.cortex/teams/dev-core/product-specs/secure-notes.md`.
- Agent implements tag search in code and domain tests.
- Agent updates `.cortex/teams/dev-core/product-specs/secure-notes.md` to document tag search behavior and rules in the same PR.

Before:

- A PR review thread decides that credit card items must validate expiration month bounds (1–12).
- Agent adds the validation to Rust code and resolves the comment.
- `.cortex/teams/dev-core/product-specs/credit-card-items.md` is left unchanged.

After:

- Agent fixes the code and adds regression tests.
- Agent updates the validation rules section in `.cortex/teams/dev-core/product-specs/credit-card-items.md` in the same commit.

## Application Checklist

- [ ] Identify if the task touches product behavior, item schemas, or UX flows.
- [ ] Select the team and read the owning specification through its graph.
- [ ] Incorporate specification requirements into the Workbench task plan.
- [ ] Update the specification when new product knowledge is gained from chat, tasks, or PR feedback.
- [ ] Create a new specification file if the feature or item type is new.
- [ ] Update [`.cortex/shared/product-specs/index.md`](../../../shared/product-specs/index.md) status and description.
- [ ] Verify that specification, code, and tests agree.
- [ ] Apply [cortex-writer.md](cortex-writer.md) to all specification edits.

## Validation

- Review the docs diff to verify that product specifications accurately describe current product behavior.
- Run `task loom:cortex-audit` to verify links, index entries, and structure.
- For implementation tasks, run the focused worker proof and commit the
  coherent formatted handoff. Include every formatter mutation in allowed
  source or Cortex paths. Return the exact commit and evidence to Gizmo. If
  integrated pre-push hygiene mutates team-owned content, that team returns a
  fresh formatted commit before Gizmo continues and pushes. Gizmo
  immediately dispatches a relevant focused remote task when the pushed head is
  not validation-ready, or complete exact-head validation when it is ready.
