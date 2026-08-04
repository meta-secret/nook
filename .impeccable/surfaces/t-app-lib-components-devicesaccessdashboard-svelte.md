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
An evidence browser that keeps local identity state, sign-in protection, and vault access separate unless a typed domain record proves a relationship. Identity and vault perspectives each show only their selected subject. Protection and local vault evidence remain available in a conventional detail panel without exposing device-key implementation details.

## Information order
1. The selected local identity or vault, without inferred connectors.
2. Independent sign-in evidence: what the browser reported and what the user named.
3. Locally observed vault access, with last-known timestamps and no identity claim.
4. When unlocked, current-vault device and backup-password summaries with links to existing management controls.
5. A persistent status readout — locked or unlocked, protection kind, verified vault count — and an opt-in note on how Nook knows each class of fact.

## Interaction and responsive behavior
The page is reachable from login and authenticated navigation. Identity and vault navigation changes the single-subject canvas. The panel below has two independent tabs for sign-in protection and vault access; arrow keys move between them. An unprepared browser shows separate identity, protection, and vault empty states and can start protection setup in place. Provider naming is an inline edit, raw WebAuthn observations sit behind one disclosure, and legacy unknowns stay explicit. Motion is limited to selection color and disclosure. All controls have visible focus and 44px touch targets.

## Visual contract
Use Nook's existing surfaces, typography, semantic colors, border radii, buttons, and dark/light themes. Verified evidence uses restrained success color; unknown evidence remains neutral; browser-reported and user-named facts are labeled in copy. No device-key nodes, inferred identity connectors, gradients, glass decoration, provider logos, fake trust scores, or inferred passkey-manager identity.
