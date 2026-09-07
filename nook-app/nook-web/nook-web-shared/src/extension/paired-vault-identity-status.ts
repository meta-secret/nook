import type { CompanionIdentityStatus } from './nook-companion-wasm/nook_companion_wasm.js'

export type ExtensionPairedVaultIdentityStatusMessageStatus =
  CompanionIdentityStatus['status']

const extensionPairedVaultIdentityStatusMessageStatusValues = {
  Unavailable: 'unavailable',
  Locked: 'locked',
  DifferentVault: 'different-vault',
  Unlocked: 'unlocked',
} satisfies Record<string, ExtensionPairedVaultIdentityStatusMessageStatus>

const extensionPairedVaultIdentityStatusMessageStatus: typeof extensionPairedVaultIdentityStatusMessageStatusValues =
  extensionPairedVaultIdentityStatusMessageStatusValues

export const ExtensionPairedVaultIdentityStatusMessageStatus = Object.freeze(
  extensionPairedVaultIdentityStatusMessageStatus,
)
