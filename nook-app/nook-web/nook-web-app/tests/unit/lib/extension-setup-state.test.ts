import { describe, expect, test } from 'vitest'
import { normalizeExtensionSetupState } from '../../../../nook-web-extension/src/popup/setup-state'

describe('extension setup state migration', () => {
  test('upgrades the legacy ready state without forcing re-pairing', () => {
    const normalized = normalizeExtensionSetupState({
      status: 'ready',
      deviceLabel: 'Laptop extension',
      pairedVaults: ['Daily'],
      selectedVaultName: 'Daily',
      syncStatus: '2 sync providers granted',
    })

    expect(normalized).toEqual({
      migrated: true,
      state: {
        status: 'ready',
        deviceLabel: 'Laptop extension',
        pairedVaults: ['Daily'],
        selectedVaultName: 'Daily',
        syncProviderCount: 2,
      },
    })
  })

  test('keeps a current ready state unchanged', () => {
    const normalized = normalizeExtensionSetupState({
      status: 'ready',
      deviceLabel: 'Laptop extension',
      pairedVaults: ['Daily'],
      syncProviderCount: 1,
    })

    expect(normalized?.migrated).toBe(false)
    expect(normalized?.state).toMatchObject({
      status: 'ready',
      syncProviderCount: 1,
    })
  })
})
