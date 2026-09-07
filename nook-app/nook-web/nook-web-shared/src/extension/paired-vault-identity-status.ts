import type { CompanionIdentityStatus } from './nook-companion-wasm/nook_companion_wasm.js'

export type ExtensionPairedVaultIdentityStatusMessageStatus =
  CompanionIdentityStatus['status']

const extensionPairedVaultIdentityStatusMessageStatus = {
  Unavailable: 'unavailable',
  Locked: 'locked',
  DifferentVault: 'different-vault',
  Unlocked: 'unlocked',
} satisfies Record<string, ExtensionPairedVaultIdentityStatusMessageStatus>

export const ExtensionPairedVaultIdentityStatusMessageStatus = Object.freeze(
  extensionPairedVaultIdentityStatusMessageStatus,
)
