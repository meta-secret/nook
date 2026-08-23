import {
  DeviceAccessProtectionKind,
  NookIdentityLocalAccessKind,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../generated/i18n-keys'
import type { VaultState } from '$lib/vault.svelte'
import {
  type DashboardView,
  DashboardTextKind,
} from '../devices-access-dashboard-state'
import type { IdentityDirectoryEntry } from './identity-directory-view'
import { buildIdentityAccessCards } from './identity-access-list'
import { isPasskeyProtection, protectionLabel } from './access-chain'

export enum IdentityKeyInventoryRowKind {
  Protector = 'protector',
  AppKey = 'app-key',
}

export type IdentityKeyInventoryRow = {
  readonly key: string
  readonly kind: IdentityKeyInventoryRowKind
  readonly title: string
  readonly typeLabel: string
  readonly protector: string
  readonly lastUsed: string
  readonly renamable: boolean
}

type IdentityKeyInventoryRequest = {
  readonly vault: VaultState
  readonly identity: IdentityDirectoryEntry
  readonly view: DashboardView
}

export function buildIdentityKeyInventory({
  vault,
  identity,
  view,
}: IdentityKeyInventoryRequest): readonly IdentityKeyInventoryRow[] {
  const rows: IdentityKeyInventoryRow[] = []
  let currentProtector = vault.t(I18N_KEYS.DevicesAccessThisBrowser)
  const currentIdentity =
    identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser
  const localMember = identity.members.find(
    (member) => member.localProtection !== DeviceAccessProtectionKind.Missing,
  )
  const localProtection = currentIdentity
    ? view.protection
    : (localMember?.localProtection ?? DeviceAccessProtectionKind.Missing)
  if (
    currentIdentity &&
    localProtection !== DeviceAccessProtectionKind.Missing
  ) {
    const cardArgs: Parameters<typeof buildIdentityAccessCards>[0] = {
      vault,
      view,
    }
    const protector = buildIdentityAccessCards(cardArgs)[0]
    if (protector) {
      currentProtector = protector.title
      const protectorRow: IdentityKeyInventoryRow = {
        key: `protector:${protector.key}`,
        kind: IdentityKeyInventoryRowKind.Protector,
        title: protector.title,
        typeLabel: protector.typeLabel,
        protector: vault.t(I18N_KEYS.DevicesAccessThisBrowser),
        lastUsed: protector.lastUsedLabel,
        renamable: isPasskeyProtection(localProtection),
      }
      rows.push(protectorRow)
    }
  } else if (localMember) {
    const protectionLabelArgs: Parameters<typeof protectionLabel>[0] = {
      vault,
      protection: localMember.localProtection,
    }
    currentProtector = protectionLabel(protectionLabelArgs)
    rows.push({
      key: `protector:${localMember.appId}`,
      kind: IdentityKeyInventoryRowKind.Protector,
      title: currentProtector,
      typeLabel: vault.t(
        isPasskeyProtection(localMember.localProtection)
          ? I18N_KEYS.DevicesAccessKeyTypePasskey
          : I18N_KEYS.DevicesAccessKeyTypePin,
      ),
      protector: vault.t(I18N_KEYS.DevicesAccessThisBrowser),
      lastUsed: vault.t(I18N_KEYS.DevicesAccessUnknown),
      renamable: false,
    })
  }

  for (const member of identity.members) {
    const isCurrent = member.currentBrowser
    const isLocal =
      member.localProtection !== DeviceAccessProtectionKind.Missing
    const isCompanion =
      isCurrent &&
      view.protection === DeviceAccessProtectionKind.CompanionSession
    const appKeyRow: IdentityKeyInventoryRow = {
      key: `app:${member.appId}`,
      kind: IdentityKeyInventoryRowKind.AppKey,
      title:
        member.label.kind === DashboardTextKind.Known
          ? member.label.value
          : `${vault.t(
              isCompanion
                ? I18N_KEYS.DevicesAccessCompanionSession
                : isCurrent || isLocal
                  ? I18N_KEYS.DevicesAccessThisBrowserAppKey
                  : I18N_KEYS.DevicesAccessOtherAppKey,
            )} · ${member.appId.slice(-8)}`,
      typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypeAppKey),
      protector:
        isCurrent || isLocal
          ? currentProtector
          : vault.t(I18N_KEYS.DevicesAccessOtherInstallation),
      lastUsed: vault.t(I18N_KEYS.DevicesAccessUnknown),
      renamable: false,
    }
    rows.push(appKeyRow)
  }
  return rows
}
