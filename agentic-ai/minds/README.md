# Minds

Minds is the home for Nook's isolated agent-worker platform.

## Workspace Crates

- **`lace`**: Experimental task-graph and Rust code-generation layer. Its
  current agent call is a no-op, so it does not yet execute a multi-agent
  workflow.
- **`hive`**: Production Neo4j-coordinated worker. It runs one embedded Codex
  thread in one Kata-backed Kubernetes Pod for each claimed task.

Agent workflow policy lives in
[`agent-workflow-orchestration.md`](../../.cortex/teams/ai/design-docs/agent-workflow-orchestration.md).

Loom remains a mechanical leaf-tool runner.

Loom owns the planned local multi-agent workflow engine.

Lace will be deleted after Loom owns the typed graph contract.

Its generated graph and no-op agent facade are not compatibility surfaces.
