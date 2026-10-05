# Security Index

Load only the category that owns the assigned security question.

## Team contract

- [Security team agent contract](AGENTS.md)

## Security architecture

- [Nook security architecture](architecture/security-architecture.md)
- [Rust platform architecture](../../../nook-app/nook-platform/.cortex/docs/architecture/index.md)
- [Vault application core architecture](../../../nook-app/nook-platform/nook-core/.cortex/docs/architecture/index.md)

## Security skills

- [Browser extension release security](dynamic-skills/browser-extension-release-security.md)
- [Secret lifecycle](dynamic-skills/secret-lifecycle.md)
- [User-facing security abstractions](dynamic-skills/user-facing-security-abstractions.md)

## Security reference

- [Identity and cryptographic specifications](../../../nook-app/nook-platform/nook-auth2/.cortex/docs/spec/index.md)

## Related team authorities

Open these only when the assigned security task needs their exact consumer
contract.

- Development core owns portable Rust implementation and security-sensitive
  product behavior.
- Web development owns browser presentation and application interaction.
- SRE owns infrastructure, deployment, and operational controls.
- AI owns Cortex, Loom, agent routing, and deterministic policy enforcement.

## Team topology

- [Security Team Gizmo](gizmo/index.md) coordinates bounded Security-team mechanics.
- [Cryptography specialist](cryptography-specialist/index.md) handles packeted cryptographic policy and review work.
- [Security review specialist](security-review-specialist/index.md) handles packeted security review and acceptance evidence.
