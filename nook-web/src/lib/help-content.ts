/** User-facing product help — keep in sync with .cortex/design-docs/unified-vault.md */

export type HelpSection = {
  id: string
  title: string
  summary: string
  bullets: string[]
  diagram?: string
}

/** Mermaid source for the local-first vault model (rendered in Help). */
export const HELP_ARCHITECTURE_DIAGRAM = `flowchart TB
  subgraph device["This browser (working copy)"]
    V[nook-vault.yaml]
    K[Device keys unlock]
  end
  subgraph sync["Sync providers (replicas)"]
    G[GitHub]
    D[Google Drive]
  end
  V <-->|version-based sync| G
  V <-->|version-based sync| D
  K --> V`

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'local-first',
    title: 'Your vault',
    summary:
      'A vault is one encrypted database. It always starts in this browser; sync providers are optional replicas — not separate vaults.',
    bullets: [
      'Create a vault here, then add GitHub or Drive in Settings to replicate it.',
      'Unlock with device keys (default) or a backup password from Settings.',
      'Secrets are encrypted before they are saved or synced anywhere.',
      'No Nook account or central server holds your data.',
    ],
    diagram: HELP_ARCHITECTURE_DIAGRAM,
  },
  {
    id: 'unlock',
    title: 'Unlocking the vault',
    summary:
      'The master password decrypts the vault. Device keys remain for quick unlock and multi-device approval.',
    bullets: [
      'Create a master password when you set up a new vault.',
      'Optional backup passwords add recovery options and power onboarding QR codes.',
      'Each browser can keep its own device key for passwordless unlock after approval.',
      'Losing every password and every approved device means the vault cannot be recovered.',
    ],
  },
  {
    id: 'sync',
    title: 'Sync providers',
    summary:
      'Connect GitHub or Google Drive to push and pull the same vault file — credentials move ciphertext only.',
    bullets: [
      'Add sync providers in Settings. Local storage stays the canonical copy.',
      'Use Sync now or Sync all to reconcile with a provider manually.',
      'After you save a secret, Nook fans out to every connected provider in the background.',
      'A provider PAT or OAuth token can read/write the encrypted file — it cannot decrypt secrets.',
    ],
  },
  {
    id: 'conflicts',
    title: 'Sync conflicts',
    summary:
      'Event-log vaults merge by appending immutable events. Legacy scalar conflicts can still appear for old copies.',
    bullets: [
      'New vaults use an append-only event log — concurrent edits on different devices usually merge automatically.',
      'The local YAML file is a projection cache only; providers sync event files under nook-log/v1/events/.',
      'If you still see a version conflict dialog, two whole-vault YAML copies diverged at the same vault_version — pick Keep local or Keep remote.',
      'After resolution, sync continues normally to all providers.',
    ],
  },
  {
    id: 'onboard',
    title: 'Onboard another browser',
    summary:
      'Generate a QR code that points a new device at a sync provider copy, then share the vault password separately.',
    bullets: [
      'Pick a connected sync provider (for example GitHub) on the Onboard tab.',
      'Confirm a vault password entry — the QR encrypts provider access, not the password itself.',
      'The new browser downloads the vault from the provider into its local cache, then unlocks with the password you share.',
      'Onboarding skips the manual join-approval round trip when a password envelope is used.',
    ],
  },
  {
    id: 'join',
    title: 'Adding another device (approval flow)',
    summary:
      'Without a QR code, a new browser sends a join request that an approved device must accept.',
    bullets: [
      'Open Nook in the new browser and connect to the same sync provider.',
      'Review the pending join on a device that already has access.',
      'Approve it — the new browser receives vault keys and can unlock.',
    ],
  },
  {
    id: 'technical',
    title: 'Technical details',
    summary:
      'Security-sensitive work runs in a Rust core compiled to WebAssembly inside your browser.',
    bullets: [
      'Each browser creates a public/private keypair; private keys never leave the device.',
      'Secrets are typed YAML records encrypted independently with age.',
      'Sync providers store nook-vault.yaml — an encrypted bundle, not plaintext secrets.',
      'Decrypted secrets exist only in the active browser session.',
    ],
  },
]
