import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm from '$app-wasm'
import {
  FirstRunDiagramArrow,
  firstRunKeyDiagram,
  firstRunSyncDiagram,
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
    const [here, provider, devices] = firstRunSyncDiagram(request).nodes

    expect(here.testId).toBe('first-run-sync-diagram-here')
    expect(provider.label).toBe('Google Drive')
    expect(provider.current).toBe(true)
    expect(provider.arrow).toBe(FirstRunDiagramArrow.Forward)
    expect(devices.testId).toBe('first-run-sync-diagram-devices')
    expect(devices.arrow).toBe(FirstRunDiagramArrow.Back)
  })

  test('the passkey leads on to the identity and its vaults', () => {
    const nodes = firstRunKeyDiagram(VaultStateTestFixture.create()).nodes
    expect(nodes.map((node) => node.arrow)).toEqual([
      FirstRunDiagramArrow.Forward,
      FirstRunDiagramArrow.Forward,
      FirstRunDiagramArrow.Forward,
    ])
  })
})
