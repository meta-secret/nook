# Product Specifications Index

## Overview

Product specifications are the living system of record for user-facing and system-level requirements.

- AI agents must read the owning specification before implementing or modifying product features.
- AI agents must update specifications in the same PR when chat conversations, task execution, or PR reviews reveal new product knowledge.
- If a new user-facing feature or item type is introduced, create a new specification file and register it below.
- Full lifecycle contract: [`dynamic-skills/product-spec-lifecycle.md`](../../teams/ai/dynamic-skills/product-spec-lifecycle.md).

## Product catalog

- **[monorepo-setup.md](../../teams/sre/product-specs/monorepo-setup.md)**
  - Description: Spec for monorepo structure, tooling & containerized workflow
  - Status: Verified
- **[password-manager.md](../../teams/dev-core/product-specs/password-manager.md)**
  - Description: Spec for password & secret manager with zero-knowledge Wasm engine
  - Status: Active; historical storage claims are labeled migration context
- **[decentralized-auth.md](../../teams/dev-core/product-specs/decentralized-auth.md)**
  - Description: Multi-device keys, vault sections, join/approve/enroll flows
  - Status: Active migration authority; logical identity and app-key alignment required
- **[browser-extension.md](../../teams/web-dev/product-specs/browser-extension.md)**
  - Description: Website-owned vault UI, extension authorization, and contextual authentication widget
  - Status: Active
- **[devices-and-access.md](../../teams/dev-core/product-specs/devices-and-access.md)**
  - Description: Multi-identity management, local key protection, onboarding, and verified vault grants
  - Status: Local multi-identity keyring implemented; replicated identity control remains active
- **[vault-app-isolation.md](../../teams/web-dev/product-specs/vault-app-isolation.md)**
  - Description: Separate Simple and Sentinel projects, origins, capabilities, and deployment
  - Status: Implemented
- **[password-envelope.md](../../teams/dev-core/product-specs/password-envelope.md)**
  - Description: Optional password envelope for `secrets_key`/`members_key` and one-step QR-based device join
  - Status: Implemented (P1–P4)
- **[slip39-recovery.md](../../teams/dev-core/product-specs/slip39-recovery.md)**
  - Description: Fixed 2-of-3 SLIP-0039 device quorum recovery via session-only QR exchange
  - Status: Draft
- **[secure-notes.md](../../teams/dev-core/product-specs/secure-notes.md)**
  - Description: Secure notes vault item type with create, edit, search, import, and encrypted free-form text
  - Status: Implemented
- **[authenticator-items.md](../../teams/dev-core/product-specs/authenticator-items.md)**
  - Description: TOTP authenticator items with a simple setup-key or URI flow
  - Status: Active
- **[credit-card-items.md](../../teams/dev-core/product-specs/credit-card-items.md)**
  - Description: Credit/debit card vault item type with Luhn-validated numbers
  - Status: Active
- **[file-attachments.md](../../teams/dev-core/product-specs/file-attachments.md)**
  - Description: Encrypted file attachment vault item type (upload/download)
  - Status: Active
