# Minds

Minds is a multi-crate Rust workspace responsible for orchestrating the AI agent team developing Nook.

## Workspace Crates

- **`lace`**: Task processing graph used by Minds to run and coordinate agents (via Codex directly as a library, Codex agent server, ACP, and LLM SDKs).
- **`hive`**: Neo4j-coordinated worker that runs one embedded Codex thread in a Kata-backed Kubernetes Pod.
