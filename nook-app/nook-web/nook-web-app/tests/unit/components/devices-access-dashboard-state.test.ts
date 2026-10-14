import { describe, expect, test } from 'vitest'
import {
  DashboardLoadKind,
  DashboardReadyProjectionOwner,
  DashboardReadyProjectionKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'

describe('Keys dashboard state', () => {
  test('projects views only when both dashboard states are ready', () => {
    const ready = new DashboardReadyProjectionOwner({
      accessState: { kind: DashboardLoadKind.Ready, view: 'access' },
      directoryState: { kind: DashboardLoadKind.Ready, view: 'directory' },
      selectedIdentity: { kind: 'selected', identity: 'identity' },
    }).state

    expect(ready).toEqual({
      kind: DashboardReadyProjectionKind.Selected,
      accessView: 'access',
      directory: 'directory',
      identity: 'identity',
    })

    const empty = new DashboardReadyProjectionOwner({
      accessState: { kind: DashboardLoadKind.Ready, view: 'access' },
      directoryState: { kind: DashboardLoadKind.Ready, view: 'directory' },
      selectedIdentity: { kind: 'empty' },
    }).state

    const accessPending = new DashboardReadyProjectionOwner({
      accessState: { kind: DashboardLoadKind.Loading },
      directoryState: { kind: DashboardLoadKind.Ready, view: 'directory' },
      selectedIdentity: { kind: 'empty' },
    }).state
    const directoryFailed = new DashboardReadyProjectionOwner({
      accessState: { kind: DashboardLoadKind.Ready, view: 'access' },
      directoryState: { kind: DashboardLoadKind.Failed },
      selectedIdentity: { kind: 'empty' },
    }).state

    expect(empty).toEqual({
      kind: DashboardReadyProjectionKind.Empty,
      accessView: 'access',
      directory: 'directory',
    })
    expect(accessPending).toEqual({
      kind: DashboardReadyProjectionKind.Unavailable,
    })
    expect(directoryFailed).toEqual({
      kind: DashboardReadyProjectionKind.Unavailable,
    })
  })
})
