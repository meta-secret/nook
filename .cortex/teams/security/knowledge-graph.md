# Security Knowledge Graph

Load only the category that owns the assigned security question.

## Team contract

- [Security team agent contract](AGENTS.md)

## Security architecture

- [Nook security architecture](architecture/security-architecture.md)
- [Identity, app keys, passkeys, and vault keys](architecture/identity-vault-architecture.md)
- [Secret store identity](architecture/secret-store-identity.md)
- [Vault session and lock](architecture/vault-session-and-lock.md)

## Security skills

- [Browser extension release security](dynamic-skills/browser-extension-release-security.md)
- [Secret lifecycle](dynamic-skills/secret-lifecycle.md)
- [User-facing security abstractions](dynamic-skills/user-facing-security-abstractions.md)

## Security reference

- [Cryptography and protected material](references/cryptography.md)

## Related team authorities

Open these only when the assigned security task needs their exact consumer
contract.

- Development core owns portable Rust implementation and security-sensitive
  product behavior.
- Web development owns browser presentation and application interaction.
- SRE owns infrastructure, deployment, and operational controls.
- AI owns Cortex, Loom, agent routing, and deterministic policy enforcement.
