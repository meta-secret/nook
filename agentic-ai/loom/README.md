# Loom

Loom weaves mechanical `.cortex` agent rites into Bun CLIs.

Policy stays in `.cortex`. Loom runs deterministic steps and returns JSON plus
exit codes.

## Prerequisites

Bun must be installed (`bun --version`). Stop and install Bun if it is missing.

## Agent entrypoints

Preferred Task surface (from the repository root):

```bash
task loom:pre-push
task loom:cortex-audit
task loom:skill-scaffold SLUG=<skill-name>
task loom:agent-stats ARGS='assemble --pr <n> --scratch <path> --out <path>'
task loom:pr-land ARGS='status --pr <n>'
```

Direct Bun surface:

```bash
bun run --cwd agentic-ai/loom loom -- help
bun run --cwd agentic-ai/loom loom -- pre-push
bun run --cwd agentic-ai/loom loom -- cortex-audit
bun run --cwd agentic-ai/loom loom -- skill-scaffold <slug>
bun run --cwd agentic-ai/loom loom -- agent-stats assemble --pr <n> --scratch <path> --out <path>
bun run --cwd agentic-ai/loom loom -- pr-land status --pr <n>
```

## Commands

| Command          | Role                                                             |
| ---------------- | ---------------------------------------------------------------- |
| `pre-push`       | Host `task format`, then UI demo contract vs `origin/main`       |
| `cortex-audit`   | Broken `.cortex` links, skill index sync, optional prose density |
| `skill-scaffold` | Create a dynamic-skill card (+ optional executable wrappers)     |
| `agent-stats`    | Assemble, validate, or publish AI-agent stats YAML               |
| `pr-land`        | Status / validate / ready / merge-check helpers over Task + `gh` |

## Quality bar

Loom holds the same authored-TypeScript invariants as the rest of the repo:

- Prettier format (`task loom:format` / `task loom:format:check`)
- `tsc --noEmit` (`task loom:check`)
- unit tests (`task loom:test`)
- preflight TypeScript state scanners (`task preflight:typescript-state`)

Aggregate:

```bash
task loom:verify
```

`task format` also runs `task loom:format` on the host after product/Hive format.
