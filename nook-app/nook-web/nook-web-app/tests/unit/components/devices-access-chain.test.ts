import { describe, expect, test } from 'vitest'
import { DeviceAccessProtectionKind } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  ACCESS_CHAIN_STAGES,
  AccessChainStage,
  panelDescription,
  panelTitle,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/access-chain'
import type { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'

/** Translations are exercised by e2e; here the evidence taxonomy is the subject. */
const vault = {
  t: (key: string) => key,
} as unknown as VaultState

describe('access detail categories', () => {
  test('offers protection and vault access without a device-key category', () => {
    expect(ACCESS_CHAIN_STAGES).toEqual([
      AccessChainStage.Unlock,
      AccessChainStage.Vaults,
    ])
    expect(ACCESS_CHAIN_STAGES).not.toContain('device-key')
  })

  test('keeps protection and vault copy independent', () => {
    expect(
      panelTitle(
        vault,
        AccessChainStage.Unlock,
        DeviceAccessProtectionKind.PasskeyStandard,
      ),
    ).toBe(I18N_KEYS.DevicesAccessPasskeyStandard)
    expect(
      panelDescription(
        vault,
        AccessChainStage.Vaults,
        DeviceAccessProtectionKind.PasskeyStandard,
      ),
    ).toBe(I18N_KEYS.DevicesAccessVaultRelationshipsDesc)
  })
})
