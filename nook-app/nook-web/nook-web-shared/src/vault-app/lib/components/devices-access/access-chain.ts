type AccessDateFormatting = {
  readonly value: string;
};

type LastUsedLabelRequest = {
  readonly value: DashboardTimestamp;
};

type DeviceProtectionLabelRequest = {
  readonly protection: DeviceAccessProtectionKind;
};

type IdentityStateLabelRequest = {
  readonly state: DeviceAccessIdentityState;
};

type AccessChainStageLabelRequest = {
  readonly stage: AccessChainStage;
  readonly protection: DeviceAccessProtectionKind;
};

type DeviceKeyTitleRequest = {
  readonly protection: DeviceAccessProtectionKind;
};

type AccessPanelTitleRequest = {
  readonly stage: AccessChainStage;
  readonly protection: DeviceAccessProtectionKind;
};

type DeviceKeyDescriptionRequest = {
  readonly protection: DeviceAccessProtectionKind;
};

type AccessPanelDescriptionRequest = {
  readonly stage: AccessChainStage;
  readonly protection: DeviceAccessProtectionKind;
};

type VerifiedVaultsLabelRequest = {
  readonly vaults: readonly VaultAccessView[];
};

type VerifiedVaultsSummaryRequest = {
  readonly vaults: readonly VaultAccessView[];
};

type UnlockNodeTitleRequest = {
  readonly protection: DeviceAccessProtectionKind;
  readonly passkeyName: DashboardText;
};

type AccessChainNodeCollection = {
  readonly input: {
    protection: DeviceAccessProtectionKind;
    passkeyName: DashboardText;
    credentialId: DashboardText;
    deviceId: DashboardText;
    vaults: readonly VaultAccessView[];
  };
};

type VaultAccessNodeRequest = {
  readonly protection: DeviceAccessProtectionKind;
  readonly vaults: readonly VaultAccessView[];
};

type VaultAccessNodeTitleRequest = {
  readonly vaults: readonly VaultAccessView[];
  readonly verified: readonly VaultAccessView[];
};

import { I18N_KEYS } from "../../../../generated/i18n-keys";

import {
  DeviceAccessIdentityState,
  DeviceAccessProtectionKind,
} from "$app-wasm";

import type { VaultState } from "$lib/vault.svelte";

import {
  type DashboardText,
  DashboardTextKind,
  type DashboardTimestamp,
  DashboardTimestampKind,
} from "../devices-access-dashboard-state";

/** One link of the browser access chain the dashboard lets a person inspect. */
export enum AccessChainStage {
  Unlock = "unlock",
  DeviceKey = "device-key",
  Vaults = "vaults",
}

export const ACCESS_CHAIN_STAGES: readonly AccessChainStage[] = [
  AccessChainStage.Unlock,
  AccessChainStage.DeviceKey,
  AccessChainStage.Vaults,
];

export enum AccessNodeDetailKind {
  Absent = "absent",
  Identifier = "identifier",
  Summary = "summary",
}

/**
 * The single supporting line under a node title: one short public identifier
 * rendered as data, a plain-language summary, or nothing yet.
 */
export type AccessNodeDetail =
  | { kind: typeof AccessNodeDetailKind.Absent }
  | { kind: typeof AccessNodeDetailKind.Identifier; value: string }
  | { kind: typeof AccessNodeDetailKind.Summary; value: string };

export enum AccessChainLinkKind {
  Origin = "origin",
  Relation = "relation",
}

/** The connector drawn before a node: nothing for the first, a verb otherwise. */
export type AccessChainLink =
  | { kind: typeof AccessChainLinkKind.Origin }
  | { kind: typeof AccessChainLinkKind.Relation; label: string };

export type AccessChainNode = {
  stage: AccessChainStage;
  caption: string;
  title: string;
  detail: AccessNodeDetail;
  incoming: AccessChainLink;
};

export type VaultAccessView = {
  storeId: string;
  label: string;
  verified: boolean;
  verifiedAt: DashboardText;
  lastLocalUpdateAt: DashboardText;
};

export enum AccessChainTabKind {
  Mounted = "mounted",
  Missing = "missing",
}

/** A chain tab can be gone by the time a rerender settles, so say so. */
export type AccessChainTab =
  | { kind: typeof AccessChainTabKind.Mounted; element: HTMLElement }
  | { kind: typeof AccessChainTabKind.Missing };

/** Owns browser orchestration for one nook web shared/src/vault app/lib/components/devices access/access chain context. */
export class AccessChainPresentation {
  constructor(private readonly vault: VaultState) {}

  static accessChainTabId(stage: AccessChainStage): string {
    return `devices-access-tab-${stage}`;
  }

  static accessChainTab(stage: AccessChainStage): AccessChainTab {
    const element = document.getElementById(
      AccessChainPresentation.accessChainTabId(stage),
    );
    return element
      ? { kind: AccessChainTabKind.Mounted, element }
      : { kind: AccessChainTabKind.Missing };
  }

  static knownText(value: DashboardText): boolean {
    return value.kind === DashboardTextKind.Known;
  }

  static textValue(value: DashboardText): string {
    return value.kind === DashboardTextKind.Known ? value.value : "";
  }

  formatAccessDate({ vault, value }: AccessDateFormatting): string {
    const vault = this.vault;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return vault.t(I18N_KEYS.DevicesAccessUnknown);
    }
    const DateTimeFormatArgs: ConstructorParameters<
      typeof Intl.DateTimeFormat
    >[1] = {
      dateStyle: "medium",
      timeStyle: "short",
    };
    return new Intl.DateTimeFormat(vault.locale, DateTimeFormatArgs).format(
      date,
    );
  }

  lastUsedLabel({ vault, value }: LastUsedLabelRequest): string {
    const vault = this.vault;
    if (value.kind === DashboardTimestampKind.Known) {
      const formatAccessDateArgs: Parameters<
        AccessChainPresentation["formatAccessDate"]
      >[0] = {
        value: value.value,
      };
      return this.formatAccessDate(formatAccessDateArgs);
    }
    return value.kind === DashboardTimestampKind.NotYetObserved
      ? vault.t(I18N_KEYS.DevicesAccessNotUsedYet)
      : vault.t(I18N_KEYS.DevicesAccessUnknownLegacy);
  }

  static isPasskeyProtection(protection: DeviceAccessProtectionKind): boolean {
    return (
      protection === DeviceAccessProtectionKind.PasskeyStandard ||
      protection === DeviceAccessProtectionKind.PasskeyAntiHacker
    );
  }

  protectionLabel({ vault, protection }: DeviceProtectionLabelRequest): string {
    const vault = this.vault;
    if (protection === DeviceAccessProtectionKind.PasskeyStandard) {
      return vault.t(I18N_KEYS.DevicesAccessPasskeyStandard);
    }
    if (protection === DeviceAccessProtectionKind.PasskeyAntiHacker) {
      return vault.t(I18N_KEYS.DevicesAccessPasskeyHighSecurity);
    }
    if (protection === DeviceAccessProtectionKind.CompanionSession) {
      return vault.t(I18N_KEYS.DevicesAccessCompanionSession);
    }
    if (protection === DeviceAccessProtectionKind.PinOrPassphrase) {
      return vault.t(I18N_KEYS.DevicesAccessPinOrPassphrase);
    }
    return vault.t(I18N_KEYS.DevicesAccessNotPrepared);
  }

  identityStateLabel({ vault }: IdentityStateLabelRequest): string {
    const vault = this.vault;
    if (state === DeviceAccessIdentityState.Unlocked) {
      return vault.t(I18N_KEYS.DevicesAccessIdentityUnlocked);
    }
    return state === DeviceAccessIdentityState.Locked
      ? vault.t(I18N_KEYS.DevicesAccessIdentityLocked)
      : vault.t(I18N_KEYS.DevicesAccessIdentityMissing);
  }

  stageLabel({
    vault,
    stage,
    protection,
  }: AccessChainStageLabelRequest): string {
    const vault = this.vault;
    if (stage === AccessChainStage.DeviceKey) {
      return vault.t(I18N_KEYS.DevicesAccessStageDeviceKey);
    }
    if (stage === AccessChainStage.Vaults) {
      return vault.t(I18N_KEYS.DevicesAccessStageVaults);
    }
    if (protection === DeviceAccessProtectionKind.PinOrPassphrase) {
      return vault.t(I18N_KEYS.DevicesAccessStagePin);
    }
    if (protection === DeviceAccessProtectionKind.CompanionSession) {
      return vault.t(I18N_KEYS.DevicesAccessStageSession);
    }
    return AccessChainPresentation.isPasskeyProtection(protection)
      ? vault.t(I18N_KEYS.DevicesAccessStagePasskey)
      : vault.t(I18N_KEYS.DevicesAccessStageUnlock);
  }

  deviceKeyTitle({ vault, protection }: DeviceKeyTitleRequest): string {
    const vault = this.vault;
    return protection === DeviceAccessProtectionKind.CompanionSession
      ? vault.t(I18N_KEYS.DevicesAccessCompanionIdentity)
      : vault.t(I18N_KEYS.DevicesAccessThisDevice);
  }

  panelTitle({ vault, stage, protection }: AccessPanelTitleRequest): string {
    const vault = this.vault;
    if (stage === AccessChainStage.DeviceKey) {
      return protection === DeviceAccessProtectionKind.CompanionSession
        ? vault.t(I18N_KEYS.DevicesAccessCompanionIdentity)
        : vault.t(I18N_KEYS.DevicesAccessDeviceAgeKey);
    }
    if (stage === AccessChainStage.Vaults) {
      return vault.t(I18N_KEYS.DevicesAccessVaultRelationships);
    }
    if (protection === DeviceAccessProtectionKind.PinOrPassphrase) {
      return vault.t(I18N_KEYS.DevicesAccessPinNodeTitle);
    }
    const protectionLabelArgs: Parameters<
      AccessChainPresentation["protectionLabel"]
    >[0] = {
      protection,
    };
    return this.protectionLabel(protectionLabelArgs);
  }

  private deviceKeyDescription({
    vault,
    protection,
  }: DeviceKeyDescriptionRequest): string {
    const vault = this.vault;
    if (protection === DeviceAccessProtectionKind.CompanionSession) {
      return vault.t(I18N_KEYS.DevicesAccessThisBrowserCompanionDesc);
    }
    return protection === DeviceAccessProtectionKind.PasskeyStandard
      ? vault.t(I18N_KEYS.DevicesAccessDeviceKeyPanelDescDerived)
      : vault.t(I18N_KEYS.DevicesAccessDeviceKeyPanelDesc);
  }

  panelDescription({
    vault,
    stage,
    protection,
  }: AccessPanelDescriptionRequest): string {
    const vault = this.vault;
    if (stage === AccessChainStage.DeviceKey) {
      const deviceKeyDescriptionArgs: Parameters<
        AccessChainPresentation["deviceKeyDescription"]
      >[0] = { protection };
      return this.deviceKeyDescription(deviceKeyDescriptionArgs);
    }
    if (stage === AccessChainStage.Vaults) {
      return vault.t(I18N_KEYS.DevicesAccessVaultRelationshipsDesc);
    }
    if (protection === DeviceAccessProtectionKind.PinOrPassphrase) {
      return vault.t(I18N_KEYS.DevicesAccessPinPanelDesc);
    }
    return protection === DeviceAccessProtectionKind.CompanionSession
      ? vault.t(I18N_KEYS.DevicesAccessThisBrowserCompanionDesc)
      : vault.t(I18N_KEYS.DevicesAccessPasskeyPanelDesc);
  }

  verifiedVaultsLabel({ vault, vaults }: VerifiedVaultsLabelRequest): string {
    const vault = this.vault;
    const tArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessVerifiedOfTotal,
      replacements: {
        verified: String(vaults.filter((entry) => entry.verified).length),
        total: String(vaults.length),
      },
    };
    return vault.t(tArgs);
  }

  private verifiedVaultsSummary({
    vault,
    vaults,
  }: VerifiedVaultsSummaryRequest): string {
    const vault = this.vault;
    const tArgs2: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessVerifiedSummary,
      replacements: {
        verified: String(vaults.filter((entry) => entry.verified).length),
        total: String(vaults.length),
      },
    };
    return vault.t(tArgs2);
  }

  private static identifierFrom(value: DashboardText): AccessNodeDetail {
    return value.kind === DashboardTextKind.Known
      ? { kind: AccessNodeDetailKind.Identifier, value: value.value }
      : { kind: AccessNodeDetailKind.Absent };
  }

  private unlockNodeTitle({
    vault,
    protection,
    passkeyName,
  }: UnlockNodeTitleRequest): string {
    const vault = this.vault;
    if (protection === DeviceAccessProtectionKind.PinOrPassphrase) {
      return vault.t(I18N_KEYS.DevicesAccessPinNodeTitle);
    }
    if (protection === DeviceAccessProtectionKind.CompanionSession) {
      return vault.t(I18N_KEYS.DevicesAccessSessionNodeTitle);
    }
    if (!AccessChainPresentation.isPasskeyProtection(protection)) {
      return vault.t(I18N_KEYS.DevicesAccessNotPrepared);
    }
    return AccessChainPresentation.knownText(passkeyName)
      ? AccessChainPresentation.textValue(passkeyName)
      : vault.t(I18N_KEYS.DevicesAccessPasskeyUnnamed);
  }

  buildAccessChainNodes({
    vault,
    input,
  }: AccessChainNodeCollection): AccessChainNode[] {
    const vault = this.vault;
    return [
      {
        stage: AccessChainStage.Unlock,
        caption: (() => {
          const stageLabelArgs: Parameters<
            AccessChainPresentation["stageLabel"]
          >[0] = {
            stage: AccessChainStage.Unlock,
            protection: input.protection,
          };
          return this.stageLabel(stageLabelArgs);
        })(),
        title: (() => {
          const unlockNodeTitleArgs: Parameters<
            AccessChainPresentation["unlockNodeTitle"]
          >[0] = {
            protection: input.protection,
            passkeyName: input.passkeyName,
          };
          return this.unlockNodeTitle(unlockNodeTitleArgs);
        })(),
        detail: AccessChainPresentation.isPasskeyProtection(input.protection)
          ? AccessChainPresentation.identifierFrom(input.credentialId)
          : { kind: AccessNodeDetailKind.Absent },
        incoming: { kind: AccessChainLinkKind.Origin },
      },
      {
        stage: AccessChainStage.DeviceKey,
        caption: (() => {
          const stageLabelArgs2: Parameters<
            AccessChainPresentation["stageLabel"]
          >[0] = {
            stage: AccessChainStage.DeviceKey,
            protection: input.protection,
          };
          return this.stageLabel(stageLabelArgs2);
        })(),
        title: (() => {
          const deviceKeyTitleArgs: Parameters<
            AccessChainPresentation["deviceKeyTitle"]
          >[0] = {
            protection: input.protection,
          };
          return this.deviceKeyTitle(deviceKeyTitleArgs);
        })(),
        detail: AccessChainPresentation.identifierFrom(input.deviceId),
        incoming: {
          kind: AccessChainLinkKind.Relation,
          label: vault.t(I18N_KEYS.DevicesAccessLinkUnlocks),
        },
      },
      (() => {
        const vaultsNodeArgs: Parameters<
          AccessChainPresentation["vaultsNode"]
        >[0] = {
          protection: input.protection,
          vaults: input.vaults,
        };
        return this.vaultsNode(vaultsNodeArgs);
      })(),
    ];
  }

  private vaultsNode({
    vault,
    protection,
    vaults,
  }: VaultAccessNodeRequest): AccessChainNode {
    const vault = this.vault;
    const verified = vaults.filter((entry) => entry.verified);
    return {
      stage: AccessChainStage.Vaults,
      caption: (() => {
        const stageLabelArgs3: Parameters<
          AccessChainPresentation["stageLabel"]
        >[0] = {
          stage: AccessChainStage.Vaults,
          protection,
        };
        return this.stageLabel(stageLabelArgs3);
      })(),
      title: (() => {
        const vaultsNodeTitleArgs: Parameters<
          AccessChainPresentation["vaultsNodeTitle"]
        >[0] = {
          vaults,
          verified,
        };
        return this.vaultsNodeTitle(vaultsNodeTitleArgs);
      })(),
      detail:
        vaults.length === 0
          ? { kind: AccessNodeDetailKind.Absent }
          : {
              kind: AccessNodeDetailKind.Summary,
              value: (() => {
                const verifiedVaultsSummaryArgs: Parameters<
                  AccessChainPresentation["verifiedVaultsSummary"]
                >[0] = { vaults };
                return this.verifiedVaultsSummary(verifiedVaultsSummaryArgs);
              })(),
            },
      incoming: {
        kind: AccessChainLinkKind.Relation,
        label: vault.t(
          vaults.length > 0 && verified.length === 0
            ? I18N_KEYS.DevicesAccessLinkUnverified
            : I18N_KEYS.DevicesAccessLinkOpens,
        ),
      },
    };
  }

  private vaultsNodeTitle({
    vault,
    vaults,
    verified,
  }: VaultAccessNodeTitleRequest): string {
    const vault = this.vault;
    if (vaults.length === 0) {
      return vault.t(I18N_KEYS.DevicesAccessNoVaultsShort);
    }
    if (verified.length === 0) {
      return vault.t(I18N_KEYS.DevicesAccessNoVerifiedVaultsShort);
    }
    const [primary, ...rest] = verified;
    return rest.length === 0
      ? primary.label
      : (() => {
          const tArgs3: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.DevicesAccessVerifiedPlusMore,
            replacements: {
              label: primary.label,
              count: String(rest.length),
            },
          };
          return vault.t(tArgs3);
        })();
  }
}
