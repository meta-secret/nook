import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm from '$app-wasm'
import {
  FirstRunDiagramArrowKind,
  FirstRunSyncDiagramProvider,
  firstRunKeyDiagram,
  firstRunSyncDiagram,
  type FirstRunKeyDiagramRequest,
  type FirstRunSyncDiagramRequest,
} from '$lib/components/login/first-run-diagram'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import GoogleDriveMark from '$lib/components/provider-marks/GoogleDriveMark.svelte'
import ICloudMark from '$lib/components/provider-marks/ICloudMark.svelte'

beforeAll(async () => {
  await initNookWasm()
})

describe('first-run diagrams', () => {
  test('both devices sync with the sync provider between them', () => {
    const request: FirstRunSyncDiagramRequest = {
      vault: VaultStateTestFixture.create(),
      provider: FirstRunSyncDiagramProvider.GoogleDrive,
    }
    const nodes = firstRunSyncDiagram(request).nodes

    expect(
      nodes.map((node) => [node.testId, node.arrow, node.current]),
    ).toEqual([
      [
        'first-run-sync-diagram-here',
        { kind: FirstRunDiagramArrowKind.Start },
        false,
      ],
      [
        'first-run-sync-diagram-provider',
        { kind: FirstRunDiagramArrowKind.Forward, label: 'syncs' },
        true,
      ],
      [
        'first-run-sync-diagram-devices',
        { kind: FirstRunDiagramArrowKind.Back, label: 'syncs' },
        false,
      ],
    ])
    expect(nodes.map((node) => node.label)).toContain('Google Drive')
  })

  test('before a provider is chosen, its box is your cloud storage, drawn with the services it can be', () => {
    const request: FirstRunSyncDiagramRequest = {
      vault: VaultStateTestFixture.create(),
      provider: FirstRunSyncDiagramProvider.Any,
    }
    const provider = firstRunSyncDiagram(request).nodes[1]

    expect(provider?.label).toBe('Your cloud storage')
    expect(provider?.icons).toEqual([GoogleDriveMark, ICloudMark])
  })

  test('the passkey unlocks the identity, by name, which opens its vaults', () => {
    const request: FirstRunKeyDiagramRequest = {
      vault: VaultStateTestFixture.create(),
      identity: 'Work',
    }
    const nodes = firstRunKeyDiagram(request).nodes
    expect(nodes.map((node) => node.label)).toContain('Work')
    expect(nodes.map((node) => node.arrow)).toEqual([
      { kind: FirstRunDiagramArrowKind.Start },
      { kind: FirstRunDiagramArrowKind.Forward, label: 'unlocks' },
      { kind: FirstRunDiagramArrowKind.Forward, label: 'opens' },
    ])
  })
})
