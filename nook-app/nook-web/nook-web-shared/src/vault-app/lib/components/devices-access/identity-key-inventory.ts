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
import {
  PASSKEY_CARD_SUMMARY_ABSENT,
  type PasskeyCardSummaryState,
} from './passkey-card'

export enum IdentityKeyInventoryRowKind {
  Protector = 'protector',
  Apps = 'apps',
}

export type IdentityAppInventoryItem = {
  readonly key: string
  readonly title: string
  readonly relationship: string
  readonly appId: string
}

export type IdentityKeyInventoryRow = {
  readonly key: string
  readonly kind: IdentityKeyInventoryRowKind
  readonly title: string
  readonly typeLabel: string
  readonly lastUsed: string
  readonly renamable: boolean
  readonly passkeySummary: PasskeyCardSummaryState
  readonly apps: readonly IdentityAppInventoryItem[]
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
  const linkedApps: IdentityAppInventoryItem[] = []
  const currentIdentity =
    identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser
  for (const [index, member] of identity.members.entries()) {
    const isCurrent = member.currentBrowser
    const localProtection =
      currentIdentity && isCurrent ? view.protection : member.localProtection
    const isLocal = localProtection !== DeviceAccessProtectionKind.Missing
    const isCompanion =
      isCurrent &&
      view.protection === DeviceAccessProtectionKind.CompanionSession
    const fallbackTitleArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessOtherAppKey,
      replacements: { count: String(index + 1) },
    }
    const appBase = {
      key: `app:${member.appId}`,
      title:
        member.label.kind === DashboardTextKind.Known
          ? member.label.value
          : isCompanion
            ? vault.t(I18N_KEYS.DevicesAccessCompanionSession)
            : isCurrent || isLocal
              ? vault.t(I18N_KEYS.DevicesAccessThisBrowserAppKey)
              : vault.t(fallbackTitleArgs),
      appId: member.appId,
    }
    if (!isLocal || localProtection === DeviceAccessProtectionKind.Missing) {
      const linkedRelationshipArgs: Parameters<typeof vault.t>[0] = {
        key: I18N_KEYS.DevicesAccessAppLinkedToIdentity,
        replacements: { identity: identity.label },
      }
      const linkedApp: IdentityAppInventoryItem = {
        ...appBase,
        relationship: vault.t(linkedRelationshipArgs),
      }
      linkedApps.push(linkedApp)
      continue
    }

    const cardArgs: Parameters<typeof buildIdentityAccessCards>[0] = {
      vault,
      view,
    }
    const currentProtectorCards =
      currentIdentity && isCurrent ? buildIdentityAccessCards(cardArgs) : []
    const currentProtector = currentProtectorCards[0]
    const protectionLabelArgs: Parameters<typeof protectionLabel>[0] = {
      vault,
      protection: localProtection,
    }
    const protectorTitle =
      currentProtector?.title ?? protectionLabel(protectionLabelArgs)
    const protectedRelationshipArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessAppProtectedBy,
      replacements: { protection: protectorTitle },
    }
    const protectorRow: IdentityKeyInventoryRow = {
      key: `protector:${member.appId}`,
      kind: IdentityKeyInventoryRowKind.Protector,
      title: protectorTitle,
      typeLabel:
        currentProtector?.typeLabel ??
        vault.t(
          isPasskeyProtection(localProtection)
            ? I18N_KEYS.DevicesAccessKeyTypePasskey
            : localProtection === DeviceAccessProtectionKind.CompanionSession
              ? I18N_KEYS.DevicesAccessKeyTypeCompanion
              : I18N_KEYS.DevicesAccessKeyTypePin,
        ),
      lastUsed:
        currentProtector?.lastUsedLabel ??
        vault.t(I18N_KEYS.DevicesAccessUnknown),
      renamable:
        Boolean(currentProtector) && isPasskeyProtection(localProtection),
      passkeySummary:
        currentProtector?.passkeySummary ?? PASSKEY_CARD_SUMMARY_ABSENT,
      apps: [
        {
          ...appBase,
          relationship: vault.t(protectedRelationshipArgs),
        },
      ],
    }
    rows.push(protectorRow)
  }

  if (linkedApps.length > 0 || rows.length === 0) {
    const appsTitleArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessAppsForIdentity,
      replacements: { identity: identity.label },
    }
    const appsRow: IdentityKeyInventoryRow = {
      key: `apps:${identity.identityId}`,
      kind: IdentityKeyInventoryRowKind.Apps,
      title: vault.t(appsTitleArgs),
      typeLabel: vault.t(I18N_KEYS.DevicesAccessAppsHeading),
      lastUsed: vault.t(I18N_KEYS.DevicesAccessUnknown),
      renamable: false,
      passkeySummary: PASSKEY_CARD_SUMMARY_ABSENT,
      apps: linkedApps,
    }
    rows.push(appsRow)
  }
  return rows
}
