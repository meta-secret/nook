import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm from '$app-wasm'
import {
  ExtensionConnectReach,
  extensionConnectDiagram,
  type ExtensionConnectDiagramRequest,
} from '$lib/components/extension-connect-diagram'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

describe('extension connect diagram', () => {
  test('the extension joins the keyring, by name, and through it every vault', () => {
    const request: ExtensionConnectDiagramRequest = {
      vault: VaultStateTestFixture.create(),
      keyring: 'Personal',
      reach: ExtensionConnectReach.Keyring,
    }
    const nodes = extensionConnectDiagram(request).nodes

    expect(nodes.map((node) => [node.testId, node.current])).toEqual([
      ['extension-connect-diagram-extension', true],
      ['extension-connect-diagram-keyring', false],
      ['extension-connect-diagram-vaults', false],
    ])
    expect(nodes.map((node) => node.label)).toContain('Personal')
  })

  test('without a cloud sync provider it reaches this vault only', () => {
    const request: ExtensionConnectDiagramRequest = {
      vault: VaultStateTestFixture.create(),
      keyring: 'Personal',
      reach: ExtensionConnectReach.ThisVault,
    }

    expect(
      extensionConnectDiagram(request).nodes.map((node) => node.testId),
    ).toEqual([
      'extension-connect-diagram-extension',
      'extension-connect-diagram-vault',
    ])
  })
})
