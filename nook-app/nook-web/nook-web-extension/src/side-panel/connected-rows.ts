import type { PairedVaultGroup, PairedVaultSummary } from '../lib/paired-vaults'

export enum ConnectedRowKind {
  Vault = 'vault',
  /** A keyring joined before it had a vault: connected all the same. */
  EmptyKeyring = 'empty-keyring',
}

/** One connected vault in its keyring's group. */
export type ConnectedVault = {
  readonly group: PairedVaultGroup
  readonly vault: PairedVaultSummary
}

/** One row of the connected list on This site. */
export type ConnectedRow =
  | ({ readonly kind: ConnectedRowKind.Vault } & ConnectedVault)
  | {
      readonly kind: ConnectedRowKind.EmptyKeyring
      readonly group: PairedVaultGroup
    }

/** Every connected vault with its keyring's group, in the groups' order; a
 * keyring with no vault yet is a row of its own, so connecting it always
 * shows. */
export function connectedRows(
  groups: readonly PairedVaultGroup[],
): ConnectedRow[] {
  return groups.flatMap((group): ConnectedRow[] =>
    group.vaults.length === 0
      ? [{ kind: ConnectedRowKind.EmptyKeyring, group }]
      : group.vaults.map((vault): ConnectedRow => ({
          kind: ConnectedRowKind.Vault,
          group,
          vault,
        })),
  )
}

/** A row's key in the list: its vault, or its keyring's device. */
export function connectedRowKey(row: ConnectedRow): string {
  switch (row.kind) {
    case ConnectedRowKind.Vault:
      return row.vault.vaultStoreId
    case ConnectedRowKind.EmptyKeyring:
      return `keyring:${row.group.deviceId}`
  }
}
