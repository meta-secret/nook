import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  extensionPairingGrantPolicyReady,
  setupStorageKey,
  type ExtensionPairingItems,
  type StoredExtensionKeyring,
  type StoredExtensionPairingGrant,
} from '../src/background/pairing-grants'
import {
  PairedVaultsMessageType,
  pairedVaultGroups,
  pairedVaultsMessages,
  type PairedKeyringSummary,
  type PairedVaultSummary,
} from '../src/lib/paired-vaults'
import {
  isPopupSender,
  type PopupSenderCheck,
} from '../src/background/service-worker/paired-vaults'

const personal: StoredExtensionPairingGrant = {
  vaultType: 'simple',
  vaultStoreId: 'store_abcdefghijk',
  deviceId: 'device',
  devicePublicKey: 'public',
  deviceSigningPublicKey: 'signing',
  vaultName: 'Personal',
  identityLabel: 'Me',
  deviceLabel: 'Laptop',
  approvedAt: 1_786_320_000_000,
  scopes: ['password-filling'],
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-1'],
  lastLocalSyncAt: '2026-08-10T00:00:00Z',
}
const work: StoredExtensionPairingGrant = {
  ...personal,
  vaultStoreId: 'store_lmnopqrstuv',
  vaultName: 'Work',
  identityLabel: 'Acme',
  approvedAt: 1_786_406_400_000,
  scopes: ['password-filling', 'passkey-management'],
}

async function twoVaultStorage(): Promise<ExtensionPairingItems> {
  const policy = await extensionPairingGrantPolicyReady
  const stored: ExtensionPairingItems = {
    [policy.pairingGrantStorageKey(personal.vaultStoreId)]: personal,
    [policy.pairingGrantStorageKey(work.vaultStoreId)]: work,
  }
  const personalDefault: Parameters<
    typeof policy.defaultVaultSelectionItems
  >[0] = { stored, vaultStoreId: personal.vaultStoreId }
  return { ...stored, ...policy.defaultVaultSelectionItems(personalDefault) }
}

describe('paired vaults', () => {
  test('choosing a default vault writes only the setup record', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const stored = await twoVaultStorage()
    const workDefault: Parameters<typeof policy.defaultVaultSelectionItems>[0] =
      { stored, vaultStoreId: work.vaultStoreId }

    const written = policy.defaultVaultSelectionItems(workDefault)

    expect(Object.keys(written)).toEqual([setupStorageKey])
  })

  test('the default vault leads the list and is the selected grant', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const stored = await twoVaultStorage()
    const workDefault: Parameters<typeof policy.defaultVaultSelectionItems>[0] =
      { stored, vaultStoreId: work.vaultStoreId }
    const updated = {
      ...stored,
      ...policy.defaultVaultSelectionItems(workDefault),
    }

    const order = policy
      .selectedPairingGrantFirst(updated)
      .map((grant) => grant.vaultName)
    const selected = policy.selectedPairingGrant(updated)

    expect(order).toEqual(['Work', 'Personal'])
    expect(selected.kind === 'selected' && selected.grant.vaultName).toBe(
      'Work',
    )
  })

  test('refuses to make an unpaired vault the default', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const stored = await twoVaultStorage()
    const unpaired: Parameters<typeof policy.defaultVaultSelectionItems>[0] = {
      stored,
      vaultStoreId: 'store_uvwxyzABCDE',
    }

    expect(() => policy.defaultVaultSelectionItems(unpaired)).toThrow()
  })

  test('decodes only well-formed paired-vault messages', () => {
    const query = Effect.runSync(
      Effect.result(
        pairedVaultsMessages.decodeQuery({
          type: PairedVaultsMessageType.Query,
        }),
      ),
    )
    const select = Effect.runSync(
      Effect.result(
        pairedVaultsMessages.decodeSelectDefault({
          type: PairedVaultsMessageType.SelectDefault,
          vaultStoreId: work.vaultStoreId,
        }),
      ),
    )
    const missingVault = Effect.runSync(
      Effect.result(
        pairedVaultsMessages.decodeSelectDefault({
          type: PairedVaultsMessageType.SelectDefault,
        }),
      ),
    )

    expect(query._tag).toBe('Success')
    expect(select._tag).toBe('Success')
    expect(missingVault._tag).toBe('Failure')
  })

  test('keeps the identity a vault was approved under', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const stored = await twoVaultStorage()

    const identities = policy
      .selectedPairingGrantFirst(stored)
      .map((grant) => [grant.vaultName, grant.identityLabel])

    expect(identities).toEqual([
      ['Personal', 'Me'],
      ['Work', 'Acme'],
    ])
  })

  test('groups vaults by identity and lists vaults with none last', () => {
    const summary = (
      vaultName: string,
      identityLabel: string,
    ): PairedVaultSummary => ({
      vaultStoreId: `store_${vaultName}`,
      vaultName,
      identityLabel,
      deviceId: 'device',
      isDefault: false,
      fillsPasswords: true,
      managesPasskeys: false,
    })
    const vaults = [
      summary('Old', ''),
      summary('Work', 'Acme'),
      summary('Personal', 'Me'),
      summary('Clients', 'Acme'),
    ]

    const groups = pairedVaultGroups({ keyrings: [], vaults }).map((group) => [
      group.identityLabel,
      group.vaults.map((vault) => vault.vaultName),
    ])

    expect(groups).toEqual([
      ['Acme', ['Work', 'Clients']],
      ['Me', ['Personal']],
      ['', ['Old']],
    ])
  })

  test('keeps each identity under the extension key it joined with', () => {
    const summary = (
      vaultName: string,
      deviceId: string,
    ): PairedVaultSummary => ({
      vaultStoreId: `store_${vaultName}`,
      vaultName,
      identityLabel: 'Family',
      deviceId,
      isDefault: false,
      fillsPasswords: true,
      managesPasskeys: false,
    })

    const groups = pairedVaultGroups({
      keyrings: [],
      vaults: [
        summary('Home', 'device-first'),
        summary('Parents', 'device-second'),
        summary('Kids', 'device-first'),
      ],
    }).map((group) => [
      group.deviceId,
      group.vaults.map((vault) => vault.vaultName),
    ])

    // Two identities may share a name; their keys tell them apart.
    expect(groups).toEqual([
      ['device-first', ['Home', 'Kids']],
      ['device-second', ['Parents']],
    ])
  })

  test('lists a joined keyring with no vault after the keyrings with vaults', () => {
    const summary = (
      vaultName: string,
      identityLabel: string,
      deviceId: string,
    ): PairedVaultSummary => ({
      vaultStoreId: `store_${vaultName}`,
      vaultName,
      identityLabel,
      deviceId,
      isDefault: false,
      fillsPasswords: true,
      managesPasskeys: false,
    })
    const keyrings: PairedKeyringSummary[] = [
      { identityLabel: 'Family', deviceId: 'device-family' },
      // A keyring that has a paired vault is listed once, with it.
      { identityLabel: 'Acme', deviceId: 'device-acme' },
    ]

    const groups = pairedVaultGroups({
      keyrings,
      vaults: [
        summary('Old', '', 'device-old'),
        summary('Work', 'Acme', 'device-acme'),
      ],
    }).map((group) => [
      group.identityLabel,
      group.deviceId,
      group.vaults.map((vault) => vault.vaultName),
    ])

    expect(groups).toEqual([
      ['Acme', 'device-acme', ['Work']],
      ['Family', 'device-family', []],
      ['', 'device-old', ['Old']],
    ])
  })

  test('a keyring joined with no vault is a group of its own', () => {
    const keyrings: PairedKeyringSummary[] = [
      { identityLabel: 'Family', deviceId: 'device-family' },
    ]

    expect(pairedVaultGroups({ keyrings, vaults: [] })).toEqual([
      { identityLabel: 'Family', deviceId: 'device-family', vaults: [] },
    ])
  })

  test('a joined keyring is read back beside the paired vaults', async () => {
    const policy = await extensionPairingGrantPolicyReady
    const family: StoredExtensionKeyring = {
      identityId: 'identity-family',
      identityLabel: 'Family',
      deviceId: 'device-family',
      devicePublicKey: 'family-public',
      deviceSigningPublicKey: 'family-signing',
      deviceLabel: 'Laptop',
      approvedAt: 1_786_500_000_000,
      scopes: ['vault-access'],
    }
    const stored: ExtensionPairingItems = {
      ...(await twoVaultStorage()),
      ...policy.keyringStorageItems(family),
    }

    expect(policy.joinedKeyrings(stored)).toEqual([family])
    // The keyring record leaves the vault list and its default unchanged.
    expect(
      policy.selectedPairingGrantFirst(stored).map((grant) => grant.vaultName),
    ).toEqual(['Personal', 'Work'])
    const selected = policy.selectedPairingGrant(stored)
    expect(selected.kind === 'selected' && selected.grant.vaultName).toBe(
      'Personal',
    )
  })

  test('answers the popup in a toolbar or a tab, never a content script', () => {
    const popupUrl = 'chrome-extension://nook-id/popup/index.html'
    const check = (sender: chrome.runtime.MessageSender): boolean => {
      const request: PopupSenderCheck = {
        sender,
        runtimeId: 'nook-id',
        popupUrl,
      }
      return isPopupSender(request)
    }

    expect(check({ id: 'nook-id', url: popupUrl })).toBe(true)
    expect(check({ id: 'nook-id', url: `${popupUrl}?intent=pair` })).toBe(true)
    expect(
      check({ id: 'nook-id', url: 'https://accounts.example.test/login' }),
    ).toBe(false)
    expect(
      check({
        id: 'nook-id',
        url: 'chrome-extension://nook-id/login-picker/index.html',
      }),
    ).toBe(false)
    expect(check({ id: 'other-id', url: popupUrl })).toBe(false)
  })
})
