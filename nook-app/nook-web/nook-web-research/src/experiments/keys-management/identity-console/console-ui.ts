/**
 * Surface tokens for the identity console.
 *
 * The architecture is Internet Identity's — an identity you pick, access
 * methods you manage, the things they open — but the surface is Handoff
 * story's: near-black, one warm accent, hairlines instead of cards, and
 * identifiers set in mono against editorial type.
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

export const PANES: readonly Pane[] = [Pane.Home, Pane.Access, Pane.Vaults]

export const ACCENT = '#ff6b3d'
export const CAPS = 'font-mono text-[10px] tracking-[0.2em] uppercase'
export const RULE = 'border-[#1e1f21]'
/** Handoff story's quoted block: a rule down the left, never a box. */
export const QUOTE = 'border-l-2 border-[#3a3b3d] pl-5'
export const STATEMENT =
  'text-[1.75rem] leading-[1.12] font-medium tracking-[-0.03em] text-balance sm:text-4xl lg:text-5xl'
export const MONO = 'font-mono tracking-[0.06em]'
/** The page's own left inset, matching the width the rail occupies. */
export const INSET = 'pr-6 pl-14 sm:pr-20 sm:pl-48 lg:pr-32 lg:pl-56'

export function paneNumeral(pane: Pane): string {
  if (pane === Pane.Home) return 'I'
  return pane === Pane.Access ? 'II' : 'III'
}

export function paneCaption(pane: Pane): string {
  if (pane === Pane.Home) return 'Identity'
  return pane === Pane.Access ? 'Access' : 'Vaults'
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
