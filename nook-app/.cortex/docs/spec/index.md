# Nook Application Specifications

- [Application logging](logging.md): WASM logger, IndexedDB persistence, log exports, and debugging protocols.
- **[password-manager.md](password-manager.md)**
  - Description: Spec for password & secret manager with zero-knowledge Wasm engine
  - Status: Active; historical storage claims are labeled migration context
- **[devices-and-access.md](devices-and-access.md)**
  - Description: Multi-identity management, local key protection, onboarding, and verified vault grants
  - Status: Local multi-identity keyring and replicated identity control implemented
- **[unified-workspace.md](unified-workspace.md)**
  - Description: Identities hub, vault page, grouped management pages, routes, and visual language
  - Status: Implemented
- **[vault-app-isolation.md](vault-app-isolation.md)**
  - Description: Separate Simple and Sentinel projects, origins, capabilities, and deployment
  - Status: Implemented

## Module specifications

- [Rust platform](../../../nook-platform/.cortex/docs/spec/index.md)
- [Browser tooling](../../../nook-web/.cortex/docs/spec/index.md)

- [Identity and authorization](../../../nook-platform/nook-auth2/.cortex/docs/spec/index.md)
- [Vault items](../../../nook-platform/nook-core/.cortex/docs/spec/index.md)
- [Personal field autofill](../../../nook-platform/nook-companion-core/.cortex/docs/spec/index.md)
- [Browser extension](../../../nook-web/nook-web-extension/.cortex/docs/spec/index.md)
