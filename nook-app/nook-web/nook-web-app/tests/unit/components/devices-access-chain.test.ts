import { describe, expect, test } from 'vitest'
import { DeviceAccessProtectionKind } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  AccessChainLinkKind,
  AccessChainStage,
  AccessNodeDetailKind,
  buildAccessChainNodes,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/access-chain'
import {
  type DashboardText,
  DashboardTextKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'
import type { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'

const known = (value: string): DashboardText => ({
  kind: DashboardTextKind.Known,
  value,
})

const unknown: DashboardText = { kind: DashboardTextKind.Unknown }

/** Translations are exercised by e2e; here the key and its data are the subject. */
const vault = {
  t: (key: string, replacements?: Record<string, string>) =>
    replacements ? `${key}(${JSON.stringify(replacements)})` : key,
} as unknown as VaultState

const vaultAccess = (label: string, verified: boolean) => ({
  storeId: `store-${label}`,
  label,
  verified,
  verifiedAt: unknown,
  lastLocalUpdateAt: unknown,
})

describe('access chain nodes', () => {
  test('gives every link exactly one identifier of its own', () => {
    const [passkey, deviceKey, vaults] = buildAccessChainNodes(vault, {
      protection: DeviceAccessProtectionKind.PasskeyStandard,
      passkeyName: known('Work laptop'),
      credentialId: known('passkey_1234'),
      deviceId: known('device_5678'),
      vaults: [vaultAccess('Family', true), vaultAccess('Archive', false)],
    })

    expect(passkey.stage).toBe(AccessChainStage.Unlock)
    expect(passkey.title).toBe('Work laptop')
    expect(passkey.detail).toEqual({
      kind: AccessNodeDetailKind.Identifier,
      value: 'passkey_1234',
    })
    expect(passkey.incoming.kind).toBe(AccessChainLinkKind.Origin)

    expect(deviceKey.detail).toEqual({
      kind: AccessNodeDetailKind.Identifier,
      value: 'device_5678',
    })
    expect(deviceKey.incoming).toEqual({
      kind: AccessChainLinkKind.Relation,
      label: I18N_KEYS.DevicesAccessLinkUnlocks,
    })

    // Vault ids would flood the diagram, so the last link summarizes instead.
    // Only the opened vault is named; the count keeps the rest visible.
    expect(vaults.title).toBe('Family')
    expect(vaults.detail).toEqual({
      kind: AccessNodeDetailKind.Summary,
      value: `${I18N_KEYS.DevicesAccessVerifiedSummary}({"verified":"1","total":"2"})`,
    })
    expect(vaults.incoming).toEqual({
      kind: AccessChainLinkKind.Relation,
      label: I18N_KEYS.DevicesAccessLinkOpens,
    })
  })

  test('does not claim access to vaults this device key never opened', () => {
    const [, , vaults] = buildAccessChainNodes(vault, {
      protection: DeviceAccessProtectionKind.PasskeyStandard,
      passkeyName: known('Work laptop'),
      credentialId: known('passkey_1234'),
      deviceId: known('device_5678'),
      vaults: [vaultAccess('Family', false), vaultAccess('Archive', false)],
    })

    expect(vaults.title).toBe(I18N_KEYS.DevicesAccessNoVerifiedVaultsShort)
    expect(vaults.detail).toEqual({
      kind: AccessNodeDetailKind.Summary,
      value: `${I18N_KEYS.DevicesAccessVerifiedSummary}({"verified":"0","total":"2"})`,
    })
    expect(vaults.incoming).toEqual({
      kind: AccessChainLinkKind.Relation,
      label: I18N_KEYS.DevicesAccessLinkUnverified,
    })
  })

  test('marks links Nook cannot name yet as absent instead of guessing', () => {
    const [passkey, , vaults] = buildAccessChainNodes(vault, {
      protection: DeviceAccessProtectionKind.PasskeyStandard,
      passkeyName: unknown,
      credentialId: unknown,
      deviceId: unknown,
      vaults: [],
    })

    expect(passkey.title).toBe(I18N_KEYS.DevicesAccessPasskeyUnnamed)
    expect(passkey.detail.kind).toBe(AccessNodeDetailKind.Absent)
    expect(vaults.title).toBe(I18N_KEYS.DevicesAccessNoVaultsShort)
    expect(vaults.detail.kind).toBe(AccessNodeDetailKind.Absent)
  })

  test('names a PIN-protected link by who can present it, not by a stored id', () => {
    const [pin] = buildAccessChainNodes(vault, {
      protection: DeviceAccessProtectionKind.PinOrPassphrase,
      passkeyName: unknown,
      credentialId: known('passkey_ignored'),
      deviceId: known('device_5678'),
      vaults: [],
    })

    expect(pin.caption).toBe(I18N_KEYS.DevicesAccessStagePin)
    expect(pin.title).toBe(I18N_KEYS.DevicesAccessPinNodeTitle)
    expect(pin.detail.kind).toBe(AccessNodeDetailKind.Absent)
  })
})
