# Minds

Minds is the home for Nook's isolated agent-worker platform.

## Workspace Crate

- **`hive`**: Production Neo4j-coordinated worker. It runs one embedded Codex
  thread in one Kata-backed Kubernetes Pod for each claimed task.

Agent workflow policy lives in
[`agent-workflow-orchestration.md`](../../.cortex/teams/ai/design-docs/agent-workflow-orchestration.md).

Loom remains a mechanical leaf-tool runner.

Loom owns the planned local multi-agent workflow engine.
