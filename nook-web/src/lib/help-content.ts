/** User-facing product help — keep in sync with .cortex/product-specs/ when architecture changes. */

export type HelpSection = {
  id: string
  title: string
  summary: string
  bullets: string[]
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'decentralized',
    title: 'Decentralized, offline-first secret manager',
    summary:
      'Nook is not a hosted password service. There is no nook account and no central server that holds your secrets.',
    bullets: [
      'Secrets are encrypted in your browser before anything is saved or synced.',
      'The encrypted vault file lives on storage you control — GitHub, this device, or future providers.',
      'Once unlocked, your vault works offline; sync catches up when the provider is reachable again.',
    ],
  },
  {
    id: 'zero-knowledge',
    title: 'Zero knowledge by design',
    summary:
      'Nook never sees your plaintext passwords. Provider credentials only grant access to the encrypted file.',
    bullets: [
      'Plaintext secrets stay in memory while the vault is open — they are not uploaded.',
      'Each browser keeps its device private key in IndexedDB; it never goes to GitHub.',
      'A GitHub token (or local storage) is storage access only — not your vault decryption key.',
    ],
  },
  {
    id: 'multi-device',
    title: 'Why more devices means stronger access',
    summary:
      'Each enrolled browser gets its own device identity and a copy of the vault keys wrapped for that device.',
    bullets: [
      'More enrolled devices = more independent ways to decrypt the same vault file.',
      'Keys are distributed in the vault `auth:` section — no single device is the only copy.',
      'If one laptop or phone is unavailable, another enrolled device can still unlock and approve joins.',
      'Adding a trusted device is intentional (join + approve) — strangers cannot read your vault file.',
    ],
  },
  {
    id: 'join',
    title: 'How join works — and why it matters',
    summary:
      'Join is how a new browser proves it should receive vault keys without nook running a central account server.',
    bullets: [
      'A new browser connects to your vault file but is not enrolled yet — it sends a join request stored in the vault.',
      'An enrolled device sees the request under Storage & devices and approves it.',
      'Approval encrypts the vault keys to the new device’s public key and adds it to the member roster.',
      'Until approval, the new browser cannot decrypt secrets — even if it can read the encrypted file from GitHub.',
      'Transfer keys (advanced) let you enroll offline if an enrolled device gave you keys out of band.',
    ],
  },
  {
    id: 'vault-file',
    title: 'What is in the vault file',
    summary:
      'Everything syncs as one YAML file (`nook-vault.yaml`) — the source of truth for secrets, devices, and pending joins.',
    bullets: [
      '`secrets:` — your labels and encrypted password values.',
      '`auth:` — per-device envelopes for `secrets_key` and `members_key`.',
      '`joins:` — pending join requests from browsers waiting for approval.',
      '`members:` — roster of enrolled devices (encrypted member records).',
    ],
  },
  {
    id: 'providers',
    title: 'Storage providers',
    summary:
      'You connect to a provider and sign in to that platform — nook stores only the encrypted vault there.',
    bullets: [
      'This device — encrypted vault in browser IndexedDB; no provider login.',
      'GitHub — sync `nook-vault.yaml` to a repo under your account (PAT with repo scope).',
      'Future providers will follow the same pattern: encrypt here, store the blob on your account.',
    ],
  },
]
