import { PasskeyKeeperKind } from "$app-wasm";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import {
  type DashboardText,
  DashboardTextKind,
  type DashboardTimestamp,
  DashboardTimestampKind,
  type DashboardView,
} from "../devices-access-dashboard-state";
import {
  formatAccessDate,
  lastUsedLabel,
  protectionLabel,
} from "./access-chain";

export enum PasskeyCardFactKind {
  Fingerprint = "fingerprint",
  Keeper = "keeper",
  Created = "created",
  LastUsed = "last-used",
}

export type PasskeyCardFact = {
  readonly kind: PasskeyCardFactKind;
  readonly label: string;
  readonly value: string;
};

export type PasskeyCardSummary = {
  readonly title: string;
  readonly typeLabel: string;
  readonly modeLabel: string;
  readonly facts: readonly PasskeyCardFact[];
};

export enum PasskeyCardSummaryKind {
  Absent = "absent",
  Present = "present",
}

export type PasskeyCardSummaryState =
  | { readonly kind: typeof PasskeyCardSummaryKind.Absent }
  | {
      readonly kind: typeof PasskeyCardSummaryKind.Present;
      readonly summary: PasskeyCardSummary;
    };

export const PASSKEY_CARD_SUMMARY_ABSENT: PasskeyCardSummaryState = {
  kind: PasskeyCardSummaryKind.Absent,
};

type PasskeyCardSummaryRequest = {
  readonly vault: VaultState;
  readonly view: DashboardView;
};

type KeeperLabelRequest = {
  readonly vault: VaultState;
  readonly keeper: PasskeyKeeperKind;
};

type CreatedLabelRequest = {
  readonly vault: VaultState;
  readonly value: DashboardTimestamp;
};

type TextOrFallbackRequest = {
  readonly value: DashboardText;
  readonly fallback: string;
};

function textOrFallback({ value, fallback }: TextOrFallbackRequest): string {
  return value.kind === DashboardTextKind.Known ? value.value : fallback;
}

function createdLabel({ vault, value }: CreatedLabelRequest): string {
  if (value.kind !== DashboardTimestampKind.Known) {
    return vault.t(I18N_KEYS.DevicesAccessUnknownLegacy);
  }
  const formatAccessDateArgs: Parameters<typeof formatAccessDate>[0] = {
    vault,
    value: value.value,
  };
  return formatAccessDate(formatAccessDateArgs);
}

function keeperLabel({ vault, keeper }: KeeperLabelRequest): string {
  const key = (() => {
    if (keeper === PasskeyKeeperKind.ApplePasswords) {
      return I18N_KEYS.DevicesAccessKeeperApplePasswords;
    }
    if (keeper === PasskeyKeeperKind.GooglePasswordManager) {
      return I18N_KEYS.DevicesAccessKeeperGooglePasswordManager;
    }
    if (keeper === PasskeyKeeperKind.Chrome) {
      return I18N_KEYS.DevicesAccessKeeperChrome;
    }
    if (keeper === PasskeyKeeperKind.ProtonPass) {
      return I18N_KEYS.DevicesAccessKeeperProtonPass;
    }
    if (keeper === PasskeyKeeperKind.OnePassword) {
      return I18N_KEYS.DevicesAccessKeeperOnepassword;
    }
    if (keeper === PasskeyKeeperKind.Bitwarden) {
      return I18N_KEYS.DevicesAccessKeeperBitwarden;
    }
    if (keeper === PasskeyKeeperKind.WindowsHello) {
      return I18N_KEYS.DevicesAccessKeeperWindowsHello;
    }
    if (keeper === PasskeyKeeperKind.Dashlane) {
      return I18N_KEYS.DevicesAccessKeeperDashlane;
    }
    if (keeper === PasskeyKeeperKind.Enpass) {
      return I18N_KEYS.DevicesAccessKeeperEnpass;
    }
    if (keeper === PasskeyKeeperKind.Keeper) {
      return I18N_KEYS.DevicesAccessKeeperKeeper;
    }
    if (keeper === PasskeyKeeperKind.NordPass) {
      return I18N_KEYS.DevicesAccessKeeperNordpass;
    }
    if (keeper === PasskeyKeeperKind.SamsungPass) {
      return I18N_KEYS.DevicesAccessKeeperSamsungPass;
    }
    return I18N_KEYS.DevicesAccessKeeperUnknown;
  })();
  return vault.t(key);
}

export function buildPasskeyCardSummary({
  vault,
  view,
}: PasskeyCardSummaryRequest): PasskeyCardSummary {
  const unknown = vault.t(I18N_KEYS.DevicesAccessUnknown);
  const keeperLabelArgs: Parameters<typeof keeperLabel>[0] = {
    vault,
    keeper: view.keeper,
  };
  const lastUsedLabelArgs: Parameters<typeof lastUsedLabel>[0] = {
    vault,
    value: view.lastUsedAt,
  };
  const protectionLabelArgs: Parameters<typeof protectionLabel>[0] = {
    vault,
    protection: view.protection,
  };
  const createdLabelArgs: Parameters<typeof createdLabel>[0] = {
    vault,
    value: view.createdAt,
  };
  const titleArgs: Parameters<typeof textOrFallback>[0] = {
    value: view.passkeyName,
    fallback: vault.t(I18N_KEYS.DevicesAccessPasskeyUnnamed),
  };
  const fingerprintArgs: Parameters<typeof textOrFallback>[0] = {
    value: view.credentialId,
    fallback: unknown,
  };
  return {
    title: textOrFallback(titleArgs),
    typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypePasskey),
    modeLabel: protectionLabel(protectionLabelArgs),
    facts: [
      {
        kind: PasskeyCardFactKind.Fingerprint,
        label: vault.t(I18N_KEYS.DevicesAccessCredentialId),
        value: textOrFallback(fingerprintArgs),
      },
      {
        kind: PasskeyCardFactKind.Keeper,
        label: vault.t(I18N_KEYS.DevicesAccessKeeperLabel),
        value:
          view.providerLabel.kind === DashboardTextKind.Known
            ? view.providerLabel.value
            : keeperLabel(keeperLabelArgs),
      },
      {
        kind: PasskeyCardFactKind.Created,
        label: vault.t(I18N_KEYS.DevicesAccessCreated),
        value: createdLabel(createdLabelArgs),
      },
      {
        kind: PasskeyCardFactKind.LastUsed,
        label: vault.t(I18N_KEYS.DevicesAccessLastUsedColumn),
        value: lastUsedLabel(lastUsedLabelArgs),
      },
    ],
  };
}
