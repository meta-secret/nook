import { describe, expect, test } from 'bun:test'
import {
  SerializedWireSnapshotKind,
  SerializedWireValueAdapter,
} from '../src/lib/serialized-wire-value-adapter'

describe('serialized wire event-log ownership', () => {
  test('never copies pairing provider credentials into the snapshot', () => {
    const personalAccessToken = 'github-pat-must-not-be-copied'
    const oauthAccessToken = 'oauth-access-token-must-not-be-copied'
    const message = {
      type: 'nook:extension-pairing-approved',
      payload: {
        providers: [
          { type: 'github', personalAccessToken },
          {
            type: 'oauth-file',
            credentials: { accessToken: oauthAccessToken },
          },
        ],
      },
      eventLogRecords: [{ event: { type: 'vault-created' } }],
    }

    const snapshot = SerializedWireValueAdapter.snapshotEventLogRecords(message)

    expect(snapshot.kind).toBe(SerializedWireSnapshotKind.Available)
    if (snapshot.kind === SerializedWireSnapshotKind.Available) {
      expect(snapshot.value).toBe('[{"event":{"type":"vault-created"}}]')
      expect(snapshot.value).not.toContain(personalAccessToken)
      expect(snapshot.value).not.toContain(oauthAccessToken)
    }
  })

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
})
