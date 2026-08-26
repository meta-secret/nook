# Dynamic Skills Workflow

## Overview

Use this workflow when the user explains a codebase-specific mistake, invariant,
or refactor pattern that should become durable agent knowledge.

`.cortex/dynamic-skills/` is the canonical repository-local skill directory for
Nook agents. The name "dynamic skills" means these skills are captured and
updated dynamically from durable project feedback; it does not mean optional,
temporary, or lower-priority guidance. Do not create a second top-level skill
registry unless this directory is renamed everywhere in `.cortex` and all mirror
links are updated in the same change.

Dynamic skills turn concrete feedback into reusable guidance:

1. A **skill card** in [`.cortex/dynamic-skills/`](../dynamic-skills/) is the
   source of truth for the pattern. Every durable repo-specific agent skill
   belongs here.
2. Executable skills live in [`.agents/skills/`](../../.agents/skills/) (the canonical open agent skill directory for Antigravity, Cursor, Claude, and Codex), with symlinks in [`.cursor/skills/`](../../.cursor/skills/) and [`.claude/skills/`](../../.claude/skills/). Skill wrappers are mirrors, not the canonical copy.
3. The registry at [`.cortex/dynamic-skills/index.md`](../dynamic-skills/index.md)
   lists every available skill card and whether it has an executable skill.
4. Mechanically executable skill actions use one host command protocol.
   - `task skills:tools-list` returns action descriptions, YAML examples, and
     input schemas.
   - `task skills:run CONFIG=<request.yaml>` accepts one domain YAML document.
   - Action-specific positional flags are prohibited.
   - Discovery and execution do not grant network, write, scheduling, delivery,
     or lifecycle authority.

## Prompt Protocol

Use these conventions in prompts:

```text
/dynamic-skill
<explain a concrete example of what is wrong and how it should work>
```

Capture or update a skill card. If the user also asks to refactor code, apply the
new or updated skill immediately after capture.

```text
Use <skill-name> and refactor <scope>
```

Read the named skill card, read any linked skill, inspect the target
scope, and apply the pattern with normal coding workflow and validation.

## Intake Workflow

1. Read [`.cortex/AGENTS.md`](../AGENTS.md) first.
2. Inspect the referenced code or files before naming the rule.
3. Distill the user's explanation into:
   - **Problem pattern:** what is wrong.
   - **Preferred pattern:** how the code should be organized.
   - **Scope:** where this applies and where it does not.
   - **Examples:** before/after references or concise pseudocode.
   - **Validation:** tests, checks, or review heuristics that prove the refactor.
4. Reuse or update an existing skill card when the concept already exists. Create
   a new card only when the lesson is meaningfully distinct.
5. Update [`.cortex/dynamic-skills/index.md`](../dynamic-skills/index.md) in the
   same change.
6. Create or update `.agents/skills/<skill-name>/SKILL.md` (and ensure `.cursor/skills/` and `.claude/skills/` symlinks exist) when the pattern is intended to be invoked directly by future agents.

For a new card scaffold, prefer Loom:

```yaml
skillScaffold:
  skillSlug: example-skill
  createExecutableWrappers: false
```

```bash
task loom:skill-scaffold CONFIG=path/to/request.yaml
```

Then fill the card content and verify with `task loom:cortex-audit`.

See [loom-tools.md](../references/loom-tools.md).

Ask for clarification only when the scope or preferred pattern cannot be inferred
from the user's example and surrounding code.

## Skill Card Rules

- Keep cards concise and actionable. They are working instructions, not essays.
- Follow [cortex-writer.md](../dynamic-skills/cortex-writer.md).
- Use short sentences, bullets, and lists.
- Follow [cortex-consistency.md](../dynamic-skills/cortex-consistency.md).
- Check new or updated cards against sibling docs and current code.
- Prefer concrete code references over copied code blocks.
- Capture durable engineering knowledge only. Do not record task status, secrets,
  temporary debugging notes, or chat-only context.
- State negative space: where the skill should not be applied.
- Include validation so refactors do not rely on prose alone.

## Applying A Dynamic Skill

When applying a skill to code:

1. Use [`.cortex/dynamic-skills/index.md`](../dynamic-skills/index.md) to find
   the matching skill card, then read that card and any linked project skill.
2. Search for candidate code by behavior and exact symbols.
3. Refactor only the requested scope unless the skill card explicitly defines a
   broader migration.
4. Preserve package boundaries in [`.cortex/ARCHITECTURE.md`](../ARCHITECTURE.md).
5. Add or update tests when the refactor changes behavior or protects a durable
   invariant.
6. Run `task loom:pre-push` before pushing. For implementation tasks, commit and
   push the coherent iteration. Run focused hosted tasks as useful. Trigger
   complete validation with `task pr:validate` when the head is ready for the
   final gate.
