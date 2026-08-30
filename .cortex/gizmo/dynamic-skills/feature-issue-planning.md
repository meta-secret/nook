# Feature Workbench Planning

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
5. Create focused issue files with testable acceptance criteria. When they
   materialize a multi-PR plan, copy each slice's canonical Gizmo ID into its
   issue's `gizmo_id` frontmatter.
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
