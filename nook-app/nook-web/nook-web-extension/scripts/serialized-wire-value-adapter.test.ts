import { describe, expect, test } from 'bun:test'
import {
  SerializedWireSnapshotKind,
  SerializedWireValueAdapter,
} from '../src/lib/serialized-wire-value-adapter'

describe('serialized wire event-log ownership', () => {
  test('snapshots nested local-update records without sibling payload fields', () => {
    const message = {
      type: 'nook:extension-local-event-log-updated',
      payload: {
        vaultStoreId: 'vault-store-id',
        eventLogRecords: [{ event: { type: 'vault-updated' } }],
        unrelatedSecret: 'must-not-be-copied',
      },
    }

    const snapshot = SerializedWireValueAdapter.snapshotEventLogRecords(message)

    expect(snapshot.kind).toBe(SerializedWireSnapshotKind.Available)
    if (snapshot.kind === SerializedWireSnapshotKind.Available) {
      expect(snapshot.value).toBe('[{"event":{"type":"vault-updated"}}]')
      expect(snapshot.value).not.toContain('must-not-be-copied')
      expect(snapshot.value).not.toContain('vault-store-id')
    }
  })

  test('a local update that carries no records has no snapshot', () => {
    const message = {
      type: 'nook:extension-local-event-log-updated',
      payload: { vaultStoreId: 'vault-store-id' },
    }

    expect(SerializedWireValueAdapter.snapshotEventLogRecords(message)).toEqual(
      { kind: SerializedWireSnapshotKind.Missing },
    )
  })

  test('restores the records a snapshot holds', () => {
    const records = [{ event: { type: 'vault-updated' } }]
    const snapshot = SerializedWireValueAdapter.snapshotEventLogRecords({
      payload: { eventLogRecords: records },
    })

    expect(snapshot.kind).toBe(SerializedWireSnapshotKind.Available)
    if (snapshot.kind === SerializedWireSnapshotKind.Available) {
      expect(
        SerializedWireValueAdapter.restoreEventLogRecords<typeof records>(
          snapshot.value,
        ),
      ).toEqual(records)
    }
  })
})
