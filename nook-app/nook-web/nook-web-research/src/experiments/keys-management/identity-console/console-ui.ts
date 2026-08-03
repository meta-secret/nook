/**
 * Shared surface tokens for the identity console.
 *
 * The sketch borrows Internet Identity's architecture: an identity you pick,
 * access methods you manage, and the things they open. Its dark card language
 * is unlike the paper sketches beside it, so the few repeated utility strings
 * live here rather than being pasted into four components.
 */
import { KeyStore } from '../_shared/key-graph'

export enum Pane {
  /** @public Read from Svelte templates; Knip cannot trace enum members there. */
  Home = 'home',
  /** @public Read from Svelte templates; Knip cannot trace enum members there. */
  Access = 'access',
  /** @public Read from Svelte templates; Knip cannot trace enum members there. */
  Vaults = 'vaults',
}

export const CAPS = 'font-mono text-[10px] tracking-[0.18em] uppercase'
export const CARD = 'rounded-xl border border-white/10 bg-[#151517]'
export const TITLE =
  'text-[26px] leading-tight tracking-[-0.01em] sm:text-[32px]'
export const MONO = 'font-mono tracking-[0.08em]'

/** A manager's own colour, so a card is recognisable before it is read. */
export function storeInk(store: KeyStore): string {
  if (store === KeyStore.ApplePasswords) return '#8e8e93'
  if (store === KeyStore.Bitwarden) return '#3b6fe0'
  if (store === KeyStore.OnePassword) return '#2f9e77'
  return '#c8952a'
}

/** Where the passkey physically lives, which is what a person forgets. */
export function storeNote(store: KeyStore): string {
  if (store === KeyStore.ApplePasswords) {
    return 'In iCloud Keychain, on Apple devices signed into your account.'
  }
  if (store === KeyStore.Bitwarden) {
    return 'In your Bitwarden account, on any device where it is unlocked.'
  }
  if (store === KeyStore.OnePassword) {
    return 'In your 1Password account, on any device where it is unlocked.'
  }
  return 'On the hardware key itself. Nowhere else.'
}
