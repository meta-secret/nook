import {
  device_access_credential_kind,
  DeviceAccessCredentialKind,
} from "$app-wasm";
import { PasskeyKeeperKind } from "$app-wasm";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import {
  type DashboardTimestamp,
  DashboardTimestampKind,
  type DashboardView,
} from "../devices-access-dashboard-state";
import { AccessChainPresentation } from "./access-chain";

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

export class PasskeyCardPresentation {
  constructor(private readonly request: PasskeyCardSummaryRequest) {}
  get summary(): PasskeyCardSummary {
    const { vault, view } = this.request;

    const unknown = vault.t(I18N_KEYS.DevicesAccessUnknown);
    const keeperLabelArgs: Parameters<typeof this.keeperLabel>[0] = {
      vault,
      keeper: view.keeper,
    };
    const lastUsedLabelArgs: Parameters<
      AccessChainPresentation["lastUsedLabel"]
    >[0] = {
      value: view.lastUsedAt,
    };
    const protectionLabelArgs: Parameters<
      AccessChainPresentation["protectionLabel"]
    >[0] = {
      protection: view.protection,
    };
    const createdLabelArgs: Parameters<typeof this.createdLabel>[0] = {
      vault,
      value: view.createdAt,
    };
    return {
      title: view.passkeyName.displayText(() =>
        vault.t(I18N_KEYS.DevicesAccessPasskeyUnnamed),
      ),
      typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypePasskey),
      modeLabel: new AccessChainPresentation(vault).protectionLabel(
        protectionLabelArgs,
      ),
      facts: [
        {
          kind: PasskeyCardFactKind.Fingerprint,
          label: vault.t(I18N_KEYS.DevicesAccessCredentialId),
          value: view.credentialId.displayText(() => unknown),
        },
        {
          kind: PasskeyCardFactKind.Keeper,
          label: vault.t(I18N_KEYS.DevicesAccessKeeperLabel),
          value: view.providerLabel.displayText(() =>
            this.keeperLabel(keeperLabelArgs),
          ),
        },
        {
          kind: PasskeyCardFactKind.Created,
          label: vault.t(I18N_KEYS.DevicesAccessCreated),
          value: this.createdLabel(createdLabelArgs),
        },
        {
          kind: PasskeyCardFactKind.LastUsed,
          label: vault.t(I18N_KEYS.DevicesAccessLastUsedColumn),
          value: new AccessChainPresentation(vault).lastUsedLabel(
            lastUsedLabelArgs,
          ),
        },
      ],
    };
  }
  private createdLabel({ vault, value }: CreatedLabelRequest): string {
    if (value.kind !== DashboardTimestampKind.Known) {
      return vault.t(I18N_KEYS.DevicesAccessUnknownLegacy);
    }
    const formatAccessDateArgs: Parameters<
      AccessChainPresentation["formatAccessDate"]
    >[0] = {
      value: value.value,
    };
    return new AccessChainPresentation(vault).formatAccessDate(
      formatAccessDateArgs,
    );
  }
  private keeperLabel({ vault, keeper }: KeeperLabelRequest): string {
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
  get state(): PasskeyCardSummaryState {
    const request = this.request;
    if (
      !(
        device_access_credential_kind(request.view.protection) ===
        DeviceAccessCredentialKind.Passkey
      )
    ) {
      return PASSKEY_CARD_SUMMARY_ABSENT;
    }
    return {
      kind: PasskeyCardSummaryKind.Present,
      summary: this.summary,
    };
  }
}
