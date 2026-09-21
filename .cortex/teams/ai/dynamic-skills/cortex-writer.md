# Nook Cortex Writer Integration

Generic authoring rules are supplied by Meta-Cortex
[Context Engineering](../../../../.meta-cortex/agents/teams/ai-team/tech-writer/skills/context-engineering/SKILL.md).
Programming and delivery examples use upstream
[Code Practice Writing](../../../../.meta-cortex/agents/teams/ai-team/tech-writer/skills/code-practice-writing/SKILL.md)
and [Delivery Writing](../../../../.meta-cortex/agents/teams/ai-team/tech-writer/skills/delivery-writing/SKILL.md).
This card owns Nook's density-lint integration. Loom continues to compose it
with the article-audit and consistency-compiler cards for Cortex write scopes.

## Mechanical lint

The changed-file density gate has bounded scope. Its implementation semantics
are described below. Execute documentation audits in the manager's slow PR
stage; this description grants no local pre-push permission.

- It compares the working branch with the merge base selected by Nook's
  pull-request audit stage. Branch and workspace creation remain owned by the
  upstream integration agent; this lint does not define local Git procedure.
- A pure rename within persistent Cortex keeps its source ancestry.
- A rename from outside persistent Cortex checks the full destination.
- A Git type change into regular Cortex Markdown checks the full file.
- Content edited during a rename remains in scope.
- It also checks untracked Cortex Markdown.
- The typed `and`-join rule checks prose spans that intersect additions or
  deletion boundaries.
  - It reconstructs ordinary hard-wrapped lines.
  - It checks each list-item paragraph independently.
  - It excludes labeled command or log output in blockquotes, fenced code,
    structural Markdown blocks, and one-line link-only index cells.
- Vale owns semicolon and sentence-length density through its native sentence
  scope.
  - It includes ordinary and labeled blockquotes, table prose, and
    reader-visible link text.
  - Inline-code width contributes to the native sentence-length count.
  - It excludes fenced code through the Markdown parser.
  - The changed gate retains a native Vale alert only when its native line
    intersects an added range.
- Neither rule family audits unchanged legacy prose.

Use Loom configuration for an explicit full-corpus density pass:

```yaml
cortexAudit:
  includeDensityLint: true
```

```bash
task loom:run CONFIG=path/to/cortex-audit-density.yaml
```

The enabled full audit runs density checks only after Cortex admission. It
checks exact persistent documents, including canonical knowledge graphs, and
excludes documents rejected for authored HTML. Typed findings retain the
`and`-join behavior above. Semicolon and length alerts retain Vale's native
sentence boundary, line, check, message, severity, cardinality, and Unicode
character counting.

It does not rewrite meaning. The agent still owns the edit.
