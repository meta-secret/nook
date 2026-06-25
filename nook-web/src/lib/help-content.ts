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
    title: 'Why Nook?',
    summary:
      'Your device is the key. No master password: your approved devices unlock the vault.',
    bullets: [
      'Passwordless access to your secrets.',
      'Your secrets. Your storage. Your keys.',
      'A decentralized vault for your secrets.',
      'No Nook account or central account server.',
      'The code and encryption flow are open source.',
    ],
  },
  {
    id: 'device-keys',
    title: 'Your devices are the keys',
    summary:
      'An approved browser opens your vault without asking for a password.',
    bullets: [
      'Each browser has its own device key.',
      'A new browser must be approved by a device that already has access.',
      'No login credentials or private keys are shared between devices.',
    ],
  },
  {
    id: 'recovery',
    title: 'Your recovery is another device',
    summary:
      'Nook cannot reset access for you. There is no master password or support desk with a spare key.',
    bullets: [
      'Approve at least two devices.',
      'If one device is lost, another can still open the vault.',
      'If every approved device is lost or erased, the vault cannot be recovered.',
    ],
  },
  {
    id: 'providers',
    title: 'You choose where the vault lives',
    summary:
      'Nook encrypts your secrets first. Only then does it save or sync the vault.',
    bullets: [
      'This device keeps the encrypted database in browser storage.',
      'GitHub syncs it to a private repository you control.',
      'Google Drive, Proton Drive, Cloudflare R2, and more are planned.',
      'A provider credential can move the encrypted vault. It cannot decrypt your secrets.',
    ],
  },
  {
    id: 'join',
    title: 'Adding another device',
    summary:
      'New devices ask to join. An approved device decides whether they receive access.',
    bullets: [
      'Open Nook in the new browser and send a join request.',
      'Review the request on an approved device.',
      'Approve it. The new browser can now unlock the same vault.',
    ],
  },
  {
    id: 'technical',
    title: 'Technical details',
    summary:
      'Nook keeps the security-sensitive work in a small Rust core compiled to WebAssembly.',
    bullets: [
      'Every browser creates a public/private keypair. The private key stays in that browser.',
      'Each secret is typed YAML encrypted independently with age encryption.',
      'GitHub stores the encrypted database as nook-vault.yaml.',
      'Decrypted secrets exist only in the active browser session.',
    ],
  },
]
