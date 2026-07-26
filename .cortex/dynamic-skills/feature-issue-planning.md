# Feature Workbench Planning

## Purpose

Organize a feature as durable, versioned context that agents can discover,
review, implement, and update without reconstructing decisions from GitHub
Issues or chat history.

## Preferred pattern

Create one `issues/<feature>/` directory in
`meta-secret/nook-workbench`. Its `README.md` is the feature boundary and owns
the goal, current state, shared decisions, references, and issue index. Each
independently deliverable slice is a focused Markdown issue beside it.

Feature directories replace milestones and aggregate issues. Focused files
replace sub-issues. Worklogs record what actually happened during execution.

## Trigger

Apply whenever the user asks to create, organize, or plan issue-level work for a
Nook feature.

## Checklist

- [ ] Search existing Workbench issues and worklogs before creating anything.
- [ ] Choose one stable, lowercase kebab-case feature directory.
- [ ] Create or update the feature `README.md` from the Workbench template.
- [ ] Record product decisions, open questions, current state, and references.
- [ ] Create focused issue files with testable acceptance criteria.
- [ ] Link dependencies explicitly; order the feature index by execution need.
- [ ] Leave drafts `status: proposed` and `automation: manual`.
- [ ] Set `status: ready` only when decisions and acceptance criteria are
      sufficient to start.
- [ ] Set `automation: agent` only when automated execution is explicitly
      intended.
- [ ] Run Workbench validation and verify the rendered files on `main`.

## Safety

Do not flatten multiple features into `issues/backlog`, erase historical
findings, or copy prompts, chats, secrets, credentials, vault data, private user
information, environment values, or raw logs.

Full workflow: [workflows/issues.md](../workflows/issues.md).
