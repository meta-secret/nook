# Nook Claude Code Entry Point

Claude Code loads this file at session start and expands the imports below.
[`AGENTS.md`](AGENTS.md) remains the single entry authority; this file only
makes its required reading load in the order it prescribes.

@AGENTS.md
@.cortex/CIRCUIT-BREAKER.md
@.cortex/meta-cortex-integration.md
@.cortex/AGENTS.md
@.cortex/index.md

The shared Meta-Cortex library lives in the ignored `.meta-cortex/` directory
of the checkout that installed it, so a fresh worktree has none. Before
repository work in a worktree, verify the pinned CLI with
`./meta-cortexw --version`, run `Framework / Info` against the installing
checkout's absolute path, then read that library's `CIRCUIT-BREAKER.md` and
`AGENTS.md`. When the library is present here, these imports load it:

@.meta-cortex/CIRCUIT-BREAKER.md
@.meta-cortex/AGENTS.md

## Subagent models

Launch Meta-Cortex roles (Gizmo Prime, Team Gizmo, specialists) through
Claude Code's own agent tool on Claude models. The `model` values in
`.meta-cortex/meta-cortex.toml` name Codex models for Codex sessions; do not
pass them here and do not rewrite that shared file. Every other role,
assignment-context, and delegation rule still applies.

---
meta-cortex: instructions
---

Read and follow [.meta-cortex/AGENTS.md](.meta-cortex/AGENTS.md).
