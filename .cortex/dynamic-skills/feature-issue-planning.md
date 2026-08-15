# Feature Workbench Planning

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines the mandatory relationship and internal-map structure.
  - Apply whenever this skill card changes.
- [Cortex writer](cortex-writer.md)
  - Keeps the card and its navigation summaries concise.
  - Apply while editing or reviewing this guidance.
- [Cortex consistency](cortex-consistency.md)
  - Requires the card to agree with related guidance and current code.
  - Apply when rules, paths, commands, or examples change.
- [Issue workflow](../workflows/issues.md)
  - Defines the canonical Workbench issue lifecycle and publication flow.
  - Read when creating or updating feature issue records.

## Document map

- [Purpose](#purpose)
  - Explains why the skill exists and what invariant it protects.
  - Read first to decide whether the skill applies.
- [Preferred pattern](#preferred-pattern)
  - Defines the required structure or behavior.
  - Read before implementing a correction.
- [Trigger](#trigger)
  - Defines the conditions that activate this skill.
  - Read while classifying the requested task.
- [Application procedure](#application-procedure)
  - Orders discovery, creation, lifecycle, and publication actions.
  - Follow while organizing feature work.
- [Safety](#safety)
  - Defines security and operational boundaries for application.
  - Read before making a risky or externally visible change.

## Purpose

Organize a feature as durable, versioned context that agents can discover,
review, implement, and update without reconstructing decisions from GitHub
Issues or chat history.

## Preferred pattern

Use one durable hierarchy:

- `issues/<feature>/` is the feature boundary in
  `meta-secret/nook-workbench`.
  - Its `README.md` owns the goal, current state, shared decisions, references,
    and issue index.
  - Each independently deliverable slice is a focused Markdown issue beside
    it.
- Feature directories replace milestones and aggregate issues.
- Focused files replace sub-issues.
- Worklogs record what actually happened during execution.

## Trigger

Apply whenever the user asks to create, organize, or plan issue-level work for a
Nook feature.

## Application procedure

1. Search existing Workbench issues and worklogs before creating anything.
2. Choose one stable, lowercase kebab-case feature directory.
3. Create or update the feature `README.md` from the Workbench template.
4. Record product decisions, open questions, current state, and references.
5. Create focused issue files with testable acceptance criteria.
6. Link dependencies explicitly and order the feature index by execution need.
7. Assign lifecycle state:
   - Leave drafts `status: proposed` and `automation: manual`.
   - Set `status: ready` only when decisions and acceptance criteria are
     sufficient to start.
   - Set `automation: agent` only when automated execution is explicitly
     intended.
8. Run Workbench validation and verify the rendered files on `main`.

## Safety

- Do not flatten multiple features into `issues/backlog`.
- Do not erase historical findings.
- Do not copy prompts, chats, secrets, credentials, vault data, private user
  information, environment values, or raw logs.

Full workflow: [workflows/issues.md](../workflows/issues.md).
