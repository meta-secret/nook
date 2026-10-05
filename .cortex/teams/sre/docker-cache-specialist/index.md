# Docker Cache Specialist Index

Load only the authority needed for the assigned Docker cache packet.

## Parent contracts

- [Docker Cache Specialist contract](AGENTS.md)
- [SRE Team Gizmo contract](../gizmo/AGENTS.md)
- [SRE team contract](../AGENTS.md)
- [SRE team index](../index.md)
- [Gizmo Prime index](../../../gizmo-prime/index.md)

## Cache authorities

- [Engineering harness](../docs/architecture/engineering-harness.md)
- [Docker container and harness hygiene](../dynamic-skills/docker-container-harness.md)
- [GitHub Actions execution and validation](../dynamic-skills/github-actions-only-validation.md)
- [CI pipeline](../workflows/ci-pipeline.md)
- [Remote execution](../workflows/remote-execution.md)

## Delivery authority

- [Multiagent delivery architecture](../../../gizmo-prime/architecture/multiagent-delivery-diagrams.md)
- [Dev delivery](../../../gizmo-prime/architecture/dev-delivery.md)

Upstream CI/CD with Nook SRE context owns remote execution. PR Lifecycle owns
PR check observation and authorized merge mechanics. The Docker specialist
owns cache implementation and evidence requirements.
