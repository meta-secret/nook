import { I18N_KEYS } from '../../../../generated/i18n-keys'
import { DeviceAccessProtectionKind } from '$app-wasm'
import type { VaultState } from '$lib/vault.svelte'
import { type DashboardView } from '../devices-access-dashboard-state'
import {
  AccessChainStage,
  isPasskeyProtection,
  lastUsedLabel,
} from './access-chain'
import {
  buildPasskeyCardSummary,
  PASSKEY_CARD_SUMMARY_ABSENT,
  PasskeyCardSummaryKind,
  type PasskeyCardSummaryState,
} from './passkey-card'

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
  readonly passkeySummary: PasskeyCardSummaryState
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
    const summaryArgs: Parameters<typeof buildPasskeyCardSummary>[0] = {
      vault,
      view,
    }
    const summary = buildPasskeyCardSummary(summaryArgs)
    const passkeyCard: IdentityAccessCard = {
      key: 'passkey',
      kind: IdentityAccessKeyKind.Passkey,
      stage: AccessChainStage.Unlock,
      title: summary.title,
      typeLabel: summary.typeLabel,
      lastUsedLabel: lastUsed,
      passkeySummary: {
        kind: PasskeyCardSummaryKind.Present,
        summary,
      },
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
      passkeySummary: PASSKEY_CARD_SUMMARY_ABSENT,
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
      passkeySummary: PASSKEY_CARD_SUMMARY_ABSENT,
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
    passkeySummary: PASSKEY_CARD_SUMMARY_ABSENT,
  }
  cards.push(appKeyCard)
  return cards
}
