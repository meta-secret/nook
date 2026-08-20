import { describe, expect, test } from 'vitest'
import {
  ExtensionSetupOfferKind,
  type ExtensionSetupOffer,
} from '$lib/app/extension-setup'
import { ExtensionSetupStatus } from '$lib/extension/install'
import {
  ConnectedVaultMenuNoteKind,
  VaultExtensionLinkKind,
  connectedVaultMenuNote,
  currentVaultCanPairExtension,
  resolveVaultExtensionLink,
  vaultEntryHoldsExtensionGrant,
  type ConnectedVaultMenuNoteRequest,
  type CurrentVaultPairingAvailabilityRequest,
  type ExtensionConnectedEntryRequest,
  type VaultExtensionLinkRequest,
  type VaultSwitcherEntryLabel,
} from '$lib/components/vault-switcher-extension'

const firstVault: VaultSwitcherEntryLabel = {
  storeId: 'store-a',
  displayName: 'Vault A',
}
const secondVault: VaultSwitcherEntryLabel = {
  storeId: 'store-b',
  displayName: 'Vault B',
}
const localEntries: readonly VaultSwitcherEntryLabel[] = [
  firstVault,
  secondVault,
]

type VaultExtensionLinkFixtureRequest = {
  offer: ExtensionSetupOffer
  activeStoreId: string
}

function linkFor(request: VaultExtensionLinkFixtureRequest) {
  const resolveRequest: VaultExtensionLinkRequest = {
    offer: request.offer,
    activeStoreId: request.activeStoreId,
    entries: localEntries,
  }
  return resolveVaultExtensionLink(resolveRequest)
}

describe('vault switcher extension link', () => {
  test('hides companion state when the setup offer is hidden', () => {
    const offer: ExtensionSetupOffer = {
      kind: ExtensionSetupOfferKind.Hidden,
    }
    const fixture: VaultExtensionLinkFixtureRequest = {
      offer,
      activeStoreId: firstVault.storeId,
    }
    const link = linkFor(fixture)
    expect(link.kind).toBe(VaultExtensionLinkKind.None)
    const pairingRequest: CurrentVaultPairingAvailabilityRequest = {
      link,
      activeStoreId: firstVault.storeId,
    }
    expect(currentVaultCanPairExtension(pairingRequest)).toBe(false)
  })

  test('treats an installed unpaired companion as pairable for the open vault', () => {
    const offer: ExtensionSetupOffer = {
      kind: ExtensionSetupOfferKind.Visible,
      setup: { status: ExtensionSetupStatus.InstalledUnpaired },
    }
    const fixture: VaultExtensionLinkFixtureRequest = {
      offer,
      activeStoreId: firstVault.storeId,
    }
    const link = linkFor(fixture)
    expect(link.kind).toBe(VaultExtensionLinkKind.Unpaired)
    const pairingRequest: CurrentVaultPairingAvailabilityRequest = {
      link,
      activeStoreId: firstVault.storeId,
    }
    expect(currentVaultCanPairExtension(pairingRequest)).toBe(true)
  })

  test('marks the open vault when the companion grant already belongs to it', () => {
    const offer: ExtensionSetupOffer = {
      kind: ExtensionSetupOfferKind.Visible,
      setup: { status: ExtensionSetupStatus.Paired },
    }
    const fixture: VaultExtensionLinkFixtureRequest = {
      offer,
      activeStoreId: firstVault.storeId,
    }
    const link = linkFor(fixture)
    expect(link).toEqual({
      kind: VaultExtensionLinkKind.Connected,
      storeId: firstVault.storeId,
      vaultName: firstVault.displayName,
    })
    const grantRequest: ExtensionConnectedEntryRequest = {
      link,
      storeId: firstVault.storeId,
    }
    expect(vaultEntryHoldsExtensionGrant(grantRequest)).toBe(true)
    const pairingRequest: CurrentVaultPairingAvailabilityRequest = {
      link,
      activeStoreId: firstVault.storeId,
    }
    expect(currentVaultCanPairExtension(pairingRequest)).toBe(false)
  })

  test('lets the open vault pair when the grant belongs to another local vault', () => {
    const offer: ExtensionSetupOffer = {
      kind: ExtensionSetupOfferKind.Visible,
      setup: {
        status: ExtensionSetupStatus.PairedElsewhere,
        connectedVaultName: firstVault.displayName,
        connectedVaultStoreId: firstVault.storeId,
      },
    }
    const fixture: VaultExtensionLinkFixtureRequest = {
      offer,
      activeStoreId: secondVault.storeId,
    }
    const link = linkFor(fixture)
    expect(link).toEqual({
      kind: VaultExtensionLinkKind.Connected,
      storeId: firstVault.storeId,
      vaultName: firstVault.displayName,
    })
    const otherGrantRequest: ExtensionConnectedEntryRequest = {
      link,
      storeId: firstVault.storeId,
    }
    expect(vaultEntryHoldsExtensionGrant(otherGrantRequest)).toBe(true)
    const pairingRequest: CurrentVaultPairingAvailabilityRequest = {
      link,
      activeStoreId: secondVault.storeId,
    }
    expect(currentVaultCanPairExtension(pairingRequest)).toBe(true)
    const noteRequest: ConnectedVaultMenuNoteRequest = {
      link,
      entries: localEntries,
    }
    expect(connectedVaultMenuNote(noteRequest).kind).toBe(
      ConnectedVaultMenuNoteKind.Hidden,
    )
  })

  test('explains a connected vault that is not on this device', () => {
    const offer: ExtensionSetupOffer = {
      kind: ExtensionSetupOfferKind.Visible,
      setup: {
        status: ExtensionSetupStatus.PairedElsewhere,
        connectedVaultName: 'Travel vault',
        connectedVaultStoreId: 'store-travel',
      },
    }
    const fixture: VaultExtensionLinkFixtureRequest = {
      offer,
      activeStoreId: firstVault.storeId,
    }
    const link = linkFor(fixture)
    const noteRequest: ConnectedVaultMenuNoteRequest = {
      link,
      entries: localEntries,
    }
    expect(connectedVaultMenuNote(noteRequest)).toEqual({
      kind: ConnectedVaultMenuNoteKind.MissingLocally,
      vaultName: 'Travel vault',
    })
    const pairingRequest: CurrentVaultPairingAvailabilityRequest = {
      link,
      activeStoreId: firstVault.storeId,
    }
    expect(currentVaultCanPairExtension(pairingRequest)).toBe(true)
  })
})
