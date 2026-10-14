import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  extensionPairingGrantPolicyReady,
  setupStorageKey,
  type ExtensionPairingItems,
  type StoredExtensionPairingGrant,
} from '../src/background/pairing-grants'
import {
  PairedVaultsMessageType,
  pairedVaultGroups,
  pairedVaultsMessages,
  type PairedVaultSummary,
} from '../src/lib/paired-vaults'

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

    const groups = pairedVaultGroups(vaults).map((group) => [
      group.identityLabel,
      group.vaults.map((vault) => vault.vaultName),
    ])

    expect(groups).toEqual([
      ['Acme', ['Work', 'Clients']],
      ['Me', ['Personal']],
      ['', ['Old']],
    ])
  })
})
