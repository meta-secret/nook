# nook-platform Architecture

- **[unified-vault.md](unified-vault.md)**
  - Description: Local-first vault model; scalar `vault_version` sync retained as historical context
  - Status: Partially historical — provider sync superseded by vault-event-log.md (see the signed vault event log catalog below)
- **[vault-architecture-modes.md](vault-architecture-modes.md)**
  - Description: Vault modes and identity-control architecture
  - Status: Implemented + target
- **[sentinel-genesis.md](sentinel-genesis.md)**
  - Description: Provider-free Sentinel reverse onboarding, threshold policy, and atomic genesis
  - Status: Implemented
- **[auth-providers.md](auth-providers.md)**
  - Description: Login gate, `nook_auth` sync-provider credentials, shared Drive/iCloud targets and authorized accounts, OAuth origins
  - Status: Active
- **[identity-vault-architecture.md](identity-vault-architecture.md)**
  - Description: Identity and vault ownership boundaries
  - Status: Implemented, including replicated identity control
- **[provider-identity-decisions.md](provider-identity-decisions.md)**
  - Description: Per-identity decisions on a sync provider: leave, add to this browser, merge, ask to join; card presentation
  - Status: Implemented
- **[vault-session-and-lock.md](vault-session-and-lock.md)**
  - Description: Lock session, vault vs sync providers, multi-vault model
  - Status: Active; compatibility storage examples are explicitly non-authoritative

## Crate architecture

- [Vault application core](../../../nook-core/.cortex/docs/architecture/index.md)
- [Signed vault event log](../../../nook-event-log/.cortex/docs/architecture/index.md)
- [Portable companion protocol](../../../nook-companion-core/.cortex/docs/architecture/index.md)
