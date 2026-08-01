---
version: 1
slug: "t-app-lib-components-devicesaccessdashboard-svelte"
primary_target: "nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/DevicesAccessDashboard.svelte"
related_targets: ["nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/LoginGate.svelte","nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/app/AuthenticatedVaultWorkspace.svelte","nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/VaultBottomNav.svelte"]
---

# Devices & access surface brief

## User and moment
Someone who cannot remember which passkey manager, browser profile, PIN, device identity, or vault relationship they used. They may have no vault, a locked vault, or an open vault.

## Direction
An evidence ledger: one strong identity header, a linear protection chain, then a vault relationship ledger. Facts carry visible provenance instead of decorative cards. The structure is calm, dense enough to be useful, and understandable before technical details are expanded.

## Information order
1. What exists on this browser and whether it is locked.
2. What protects it: passkey or local PIN/passphrase.
3. What Nook knows, what the browser reported, what the user named, and what remains unknown.
4. Which vaults this identity was verified to open, with last-known timestamps.
5. When unlocked, current-vault device and backup-password summaries with links to existing management controls.

## Interaction and responsive behavior
The page is reachable from login and authenticated navigation. Provider naming is an inline edit, technical IDs are disclosed on request, and legacy unknowns stay explicit. Desktop uses a narrow explanatory rail beside the ledger; mobile becomes a single ordered column. Motion is limited to the technical-details disclosure and section replacement. All controls have visible focus and 44px touch targets.

## Visual contract
Use Nook's existing surfaces, typography, semantic colors, border radii, buttons, and dark/light themes. Verified evidence uses restrained success color; unknown evidence remains neutral; browser-reported and user-named facts are labeled in copy. No gradients, glass decoration, provider logos, fake trust scores, or inferred passkey-manager identity.
