import { I18N_KEYS } from "../../../../generated/i18n-keys";
import { DeviceAccessProtectionKind } from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import { type DashboardView } from "../devices-access-dashboard-state";
import { AccessChainStage, AccessChainPresentation } from "./access-chain";
import {
  PasskeyCardPresentation,
  PASSKEY_CARD_SUMMARY_ABSENT,
  PasskeyCardSummaryKind,
  type PasskeyCardSummaryState,
} from "./passkey-card";

export enum IdentityAccessKeyKind {
  Passkey = "passkey",
  PinOrPassphrase = "pin-or-passphrase",
  CompanionSession = "companion-session",
  AppKey = "app-key",
}

export type IdentityAccessCard = {
  readonly key: string;
  readonly kind: IdentityAccessKeyKind;
  readonly stage: AccessChainStage;
  readonly title: string;
  readonly typeLabel: string;
  readonly lastUsedLabel: string;
  readonly passkeySummary: PasskeyCardSummaryState;
};

type IdentityAccessCardsRequest = {
  readonly vault: VaultState;
  readonly view: DashboardView;
};

export class IdentityAccessPresentation {
  constructor(private readonly request: IdentityAccessCardsRequest) {}
  get cards(): readonly IdentityAccessCard[] {
    const { vault, view } = this.request;

    const cards: IdentityAccessCard[] = [];
    const lastUsedLabelArgs: Parameters<
      AccessChainPresentation["lastUsedLabel"]
    >[0] = {
      value: view.lastUsedAt,
    };
    const lastUsed = new AccessChainPresentation(vault).lastUsedLabel(
      lastUsedLabelArgs,
    );
    if (AccessChainPresentation.isPasskeyProtection(view.protection)) {
      const summaryArgs: ConstructorParameters<
        typeof PasskeyCardPresentation
      >[0] = {
        vault,
        view,
      };
      const summary = new PasskeyCardPresentation(summaryArgs).summary;
      const passkeyCard: IdentityAccessCard = {
        key: "passkey",
        kind: IdentityAccessKeyKind.Passkey,
        stage: AccessChainStage.Unlock,
        title: summary.title,
        typeLabel: summary.typeLabel,
        lastUsedLabel: lastUsed,
        passkeySummary: {
          kind: PasskeyCardSummaryKind.Present,
          summary,
        },
      };
      cards.push(passkeyCard);
    } else if (view.protection === DeviceAccessProtectionKind.PinOrPassphrase) {
      const pinCard: IdentityAccessCard = {
        key: "pin",
        kind: IdentityAccessKeyKind.PinOrPassphrase,
        stage: AccessChainStage.Unlock,
        title: vault.t(I18N_KEYS.DevicesAccessPinOrPassphrase),
        typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypePin),
        lastUsedLabel: lastUsed,
        passkeySummary: PASSKEY_CARD_SUMMARY_ABSENT,
      };
      cards.push(pinCard);
    } else if (
      view.protection === DeviceAccessProtectionKind.CompanionSession
    ) {
      const companionCard: IdentityAccessCard = {
        key: "companion",
        kind: IdentityAccessKeyKind.CompanionSession,
        stage: AccessChainStage.Unlock,
        title: vault.t(I18N_KEYS.DevicesAccessCompanionSession),
        typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypeCompanion),
        lastUsedLabel: lastUsed,
        passkeySummary: PASSKEY_CARD_SUMMARY_ABSENT,
      };
      cards.push(companionCard);
    }

    if (cards.length > 0) {
      return cards;
    }

    const appKeyCard: IdentityAccessCard = {
      key: "app-key",
      kind: IdentityAccessKeyKind.AppKey,
      stage: AccessChainStage.DeviceKey,
      title: vault.t(I18N_KEYS.DevicesAccessDeviceAgeKey),
      typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypeAppKey),
      lastUsedLabel: lastUsed,
      passkeySummary: PASSKEY_CARD_SUMMARY_ABSENT,
    };
    cards.push(appKeyCard);
    return cards;
  }
}
