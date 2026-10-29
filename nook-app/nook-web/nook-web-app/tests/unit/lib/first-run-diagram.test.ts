import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm from '$app-wasm'
import {
  FirstRunDiagramArrow,
  firstRunKeyDiagram,
  firstRunSyncDiagram,
  type FirstRunKeyDiagramRequest,
  type FirstRunSyncDiagramRequest,
} from '$lib/components/login/first-run-diagram'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

describe('first-run diagrams', () => {
  test('both devices point at the sync provider between them', () => {
    const request: FirstRunSyncDiagramRequest = {
      vault: VaultStateTestFixture.create(),
      provider: 'Google Drive',
    }
    const nodes = firstRunSyncDiagram(request).nodes

    expect(
      nodes.map((node) => [node.testId, node.arrow, node.current]),
    ).toEqual([
      ['first-run-sync-diagram-here', FirstRunDiagramArrow.Forward, false],
      ['first-run-sync-diagram-provider', FirstRunDiagramArrow.Forward, true],
      ['first-run-sync-diagram-devices', FirstRunDiagramArrow.Back, false],
    ])
    expect(nodes.map((node) => node.label)).toContain('Google Drive')
  })

  test('the passkey leads on to the identity it opens, by name, and its vaults', () => {
    const request: FirstRunKeyDiagramRequest = {
      vault: VaultStateTestFixture.create(),
      identity: 'Work',
    }
    const nodes = firstRunKeyDiagram(request).nodes
    expect(nodes.map((node) => node.label)).toContain('Work')
    expect(nodes.map((node) => node.arrow)).toEqual([
      FirstRunDiagramArrow.Forward,
      FirstRunDiagramArrow.Forward,
      FirstRunDiagramArrow.Forward,
    ])
  })
})
