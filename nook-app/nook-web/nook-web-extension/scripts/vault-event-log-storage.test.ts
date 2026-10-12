import { expect, mock, test } from 'bun:test'
import { Effect } from 'effect'
import { ExtensionVaultEventLogExport } from '../src/background/service-worker/vault-event-log-export'
import type { ExtensionPairingItems } from '../src/background/pairing-grants'

test('event-log export loads all pairing rows without treating Effect cancellation as a storage key', async () => {
  const loadPairingStorage = mock(
    async (key?: string): Promise<ExtensionPairingItems> => {
      if (key !== undefined)
        throw new Error('Expected an unfiltered pairing read')
      return {}
    },
  )
  const dependencies: ConstructorParameters<
    typeof ExtensionVaultEventLogExport
  >[0] = {
    loadPairingStorage,
    openSessionDocument: async () => {
      throw new Error('Session unavailable in fixture')
    },
  }
  const result = await Effect.runPromise(
    new ExtensionVaultEventLogExport(dependencies).run({
      type: 'ExportVaultEventLog',
      payload: { vault_store_id: 'store_abcdefghijk' },
    }),
  )
  expect(loadPairingStorage).toHaveBeenCalledWith()
  expect(result).toEqual({ kind: 'Rejected', reason: 'Unavailable' })
})
