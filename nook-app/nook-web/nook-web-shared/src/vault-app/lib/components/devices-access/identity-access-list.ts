import { I18N_KEYS } from '../../../../generated/i18n-keys'
import { DeviceAccessProtectionKind } from '$app-wasm'
import type { VaultState } from '$lib/vault.svelte'
import { type DashboardView } from '../devices-access-dashboard-state'
import {
  AccessChainStage,
  isPasskeyProtection,
  knownText,
  lastUsedLabel,
  textValue,
} from './access-chain'

export enum IdentityAccessKeyKind {
  Passkey = 'passkey',
  PinOrPassphrase = 'pin-or-passphrase',
  CompanionSession = 'companion-session',
  AppKey = 'app-key',
}

export type IdentityAccessCard = {
  readonly key: string
  readonly kind: IdentityAccessKeyKind
  readonly stage: AccessChainStage
  readonly title: string
  readonly typeLabel: string
  readonly lastUsedLabel: string
}

type IdentityAccessCardsRequest = {
  readonly vault: VaultState
  readonly view: DashboardView
}

export function buildIdentityAccessCards({
  vault,
  view,
}: IdentityAccessCardsRequest): readonly IdentityAccessCard[] {
  const cards: IdentityAccessCard[] = []
  const lastUsedLabelArgs: Parameters<typeof lastUsedLabel>[0] = {
    vault,
    value: view.lastUsedAt,
  }
  const lastUsed = lastUsedLabel(lastUsedLabelArgs)
  if (isPasskeyProtection(view.protection)) {
    const namedPasskey = knownText(view.passkeyName)
      ? textValue(view.passkeyName)
      : vault.t(I18N_KEYS.DevicesAccessPasskeyUnnamed)
    const passkeyCard: IdentityAccessCard = {
      key: 'passkey',
      kind: IdentityAccessKeyKind.Passkey,
      stage: AccessChainStage.Unlock,
      title: namedPasskey,
      typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypePasskey),
      lastUsedLabel: lastUsed,
    }
    cards.push(passkeyCard)
  } else if (view.protection === DeviceAccessProtectionKind.PinOrPassphrase) {
    const pinCard: IdentityAccessCard = {
      key: 'pin',
      kind: IdentityAccessKeyKind.PinOrPassphrase,
      stage: AccessChainStage.Unlock,
      title: vault.t(I18N_KEYS.DevicesAccessPinOrPassphrase),
      typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypePin),
      lastUsedLabel: lastUsed,
    }
    cards.push(pinCard)
  } else if (view.protection === DeviceAccessProtectionKind.CompanionSession) {
    const companionCard: IdentityAccessCard = {
      key: 'companion',
      kind: IdentityAccessKeyKind.CompanionSession,
      stage: AccessChainStage.Unlock,
      title: vault.t(I18N_KEYS.DevicesAccessCompanionSession),
      typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypeCompanion),
      lastUsedLabel: lastUsed,
    }
    cards.push(companionCard)
  }

  if (cards.length > 0) {
    return cards
  }

  const appKeyCard: IdentityAccessCard = {
    key: 'app-key',
    kind: IdentityAccessKeyKind.AppKey,
    stage: AccessChainStage.DeviceKey,
    title: vault.t(I18N_KEYS.DevicesAccessDeviceAgeKey),
    typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypeAppKey),
    lastUsedLabel: lastUsed,
  }
  cards.push(appKeyCard)
  return cards
}
