import { describe, expect, test } from 'bun:test'
import {
  pairedVaultGroups,
  type PairedConnections,
  type PairedVaultSummary,
} from '../src/lib/paired-vaults'
import {
  ConnectedRowKind,
  connectedRowKey,
  connectedRows,
} from '../src/side-panel/connected-rows'

function vault(name: string, deviceId: string): PairedVaultSummary {
  return {
    vaultStoreId: `store-${name}`,
    vaultName: name,
    identityLabel: 'Personal',
    deviceId,
    isDefault: false,
    fillsPasswords: true,
    managesPasskeys: false,
  }
}

describe('connected list on This site', () => {
  test('a keyring connected before it has a vault is a row of its own', () => {
    const connections: PairedConnections = {
      keyrings: [{ identityLabel: 'Personal', deviceId: 'app-personal' }],
      vaults: [],
    }

    const rows = connectedRows(pairedVaultGroups(connections))

    expect(rows.map((row) => row.kind)).toEqual([ConnectedRowKind.EmptyKeyring])
    expect(rows.map(connectedRowKey)).toEqual(['keyring:app-personal'])
  })

  test('a keyring with vaults lists each vault and no empty row', () => {
    const connections: PairedConnections = {
      keyrings: [
        { identityLabel: 'Personal', deviceId: 'app-personal' },
        { identityLabel: 'Work', deviceId: 'app-work' },
      ],
      vaults: [
        vault('Passwords', 'app-personal'),
        vault('Cards', 'app-personal'),
      ],
    }

    const rows = connectedRows(pairedVaultGroups(connections))

    expect(rows.map((row) => row.kind)).toEqual([
      ConnectedRowKind.Vault,
      ConnectedRowKind.Vault,
      ConnectedRowKind.EmptyKeyring,
    ])
    expect(rows.map(connectedRowKey)).toEqual([
      'store-Passwords',
      'store-Cards',
      'keyring:app-work',
    ])
  })
})
