# Product Specifications Index

## Relationships

- [Authenticator Items](authenticator-items.md)
  - Defines TOTP item input, storage, display, enrollment capture, and extension use.
  - Open when routing to authenticator-item product behavior.
- [Browser Extension Product Spec](browser-extension.md)
  - Defines the companion extension boundary, approval, authentication surfaces, and storage rules.
  - Open when routing to browser-companion behavior.
- [Credit Card Items](credit-card-items.md)
  - Defines payment-card fields, validation, display, import, and security behavior.
  - Open when routing to payment-card product behavior.
- [Multi-Device Decentralized Auth Specification](decentralized-auth.md)
  - Defines multi-device keys, enrollment, approval, revocation, and vault authorization.
  - Open when routing to multi-device authorization behavior.
- [Devices & access](devices-and-access.md)
  - Defines identity, device protection evidence, onboarding, and verified vault grants.
  - Open when routing to identity, device, or vault-grant behavior.
- [File Attachments](file-attachments.md)
  - Defines encrypted attachment upload, metadata, download, limits, and security behavior.
  - Open when routing to file-attachment product behavior.
- [Product Spec: Monorepo & Toolchain Setup](monorepo-setup.md)
  - Defines the repository toolchain, containerized workflow, and build-cache product requirements.
  - Open when routing to the development-environment specification.
- [Password Unlock & QR-Based Device Join](password-envelope.md)
  - Defines password-wrapped vault keys and the one-step device-join envelope.
  - Open when routing to password unlock or QR join behavior.
- [Nook Password Manager Specification](password-manager.md)
  - Defines the core vault product, user flows, storage formats, cryptography, and UI boundaries.
  - Open when routing to the core password-manager specification.
- [Secure Notes](secure-notes.md)
  - Defines free-form encrypted note fields, UI behavior, import, and implementation status.
  - Open when routing to secure-note product behavior.
- [SLIP-0039 Device Quorum Recovery](slip39-recovery.md)
  - Defines fixed-quorum device recovery and its session-only QR exchange.
  - Open when routing to device-quorum recovery behavior.
- [Simple and Sentinel Application Isolation](vault-app-isolation.md)
  - Defines the separate Simple and Sentinel application surfaces, origins, and deployment.
  - Open when routing to Simple or Sentinel product isolation.
- [Nook Coding Rules & Golden Principles](../rules.md)
  - Defines the repository-wide implementation, testing, tooling, and delivery constraints.
  - Apply throughout implementation and review.

## Document map

- [Product catalog](#product-catalog)
  - Lists every product specification with its owned behavior and current status.
  - Scan when choosing the authoritative product document for a task.

## Product catalog

Product specs detail the user-facing and system-level requirements.

| Specification | Description | Status |
|---|---|---|
| [monorepo-setup.md](monorepo-setup.md) | Spec for monorepo structure, tooling & containerized workflow | Verified |
| [password-manager.md](password-manager.md) | Spec for password & secret manager with zero-knowledge Wasm engine | Verified |
| [decentralized-auth.md](decentralized-auth.md) | Multi-device keys, vault sections, join/approve/enroll flows | Verified |
| [browser-extension.md](browser-extension.md) | Website-owned vault UI, extension authorization, and contextual authentication widget | Active |
| [devices-and-access.md](devices-and-access.md) | Identity management, device protection evidence, onboarding, and verified vault grants | Implemented dashboard; broader identity model is an architecture decision |
| [vault-app-isolation.md](vault-app-isolation.md) | Separate Simple and Sentinel projects, origins, capabilities, and deployment | Implemented |
| [password-envelope.md](password-envelope.md) | Optional password envelope for `secrets_key`/`members_key` and one-step QR-based device join | Implemented (P1–P4) |
| [slip39-recovery.md](slip39-recovery.md) | Fixed 2-of-3 SLIP-0039 device quorum recovery via session-only QR exchange | Draft |
| [secure-notes.md](secure-notes.md) | Secure notes vault item type with create, edit, search, import, and encrypted free-form text | Implemented |
| [authenticator-items.md](authenticator-items.md) | TOTP authenticator items with a simple setup-key or URI flow | Active |
| [credit-card-items.md](credit-card-items.md) | Credit/debit card vault item type with Luhn-validated numbers | Active |
| [file-attachments.md](file-attachments.md) | Encrypted file attachment vault item type (upload/download) | Active |
