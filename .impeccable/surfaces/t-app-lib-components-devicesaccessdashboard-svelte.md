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
A hairline schematic of the access chain as the subject: passkey, browser device key, vaults, connected by labeled relations. Each link carries one identifier, and selecting a link replaces one panel below with that link's evidence, so the relationship and its detail never drift apart. A quiet readout rail keeps the always-true status beside the schematic instead of explaining how to read the page.

## Information order
1. The chain itself: what the person presents, the browser device key it unlocks, the vaults it opens.
2. The selected link's own evidence: its identifier, what Nook verified, what the browser reported, what the user named.
3. Which vaults this device key was verified to open, with last-known timestamps.
4. When unlocked, current-vault device and backup-password summaries with links to existing management controls.
5. A persistent status readout — locked or unlocked, protection kind, verified vault count — and an opt-in note on how Nook knows each class of fact.

## Interaction and responsive behavior
The page is reachable from login and authenticated navigation. The chain nodes are a tab list: click or arrow keys move selection, and the panel below is the tab panel. An unprepared browser previews the chain it is about to build and starts device protection in place. Provider naming is an inline edit, raw WebAuthn observations sit behind one disclosure, and legacy unknowns stay explicit. Desktop places the readout rail beside the schematic; mobile stacks the chain vertically with the relations between nodes and drops the rail below the evidence. Motion is limited to selection color and disclosure. All controls have visible focus and 44px touch targets.

## Visual contract
Use Nook's existing surfaces, typography, semantic colors, border radii, buttons, and dark/light themes. Verified evidence uses restrained success color; unknown evidence remains neutral; browser-reported and user-named facts are labeled in copy. No gradients, glass decoration, provider logos, fake trust scores, or inferred passkey-manager identity.
