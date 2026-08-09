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

export function accessChainTabId(stage: AccessChainStage): string {
  return `devices-access-tab-${stage}`;
}

export enum AccessChainTabKind {
  Mounted = "mounted",
  Missing = "missing",
}

/** A chain tab can be gone by the time a rerender settles, so say so. */
export type AccessChainTab =
  | { kind: typeof AccessChainTabKind.Mounted; element: HTMLElement }
  | { kind: typeof AccessChainTabKind.Missing };

export function accessChainTab(stage: AccessChainStage): AccessChainTab {
  const element = document.getElementById(accessChainTabId(stage));
  return element
    ? { kind: AccessChainTabKind.Mounted, element }
    : { kind: AccessChainTabKind.Missing };
}

export function knownText(value: DashboardText): boolean {
  return value.kind === DashboardTextKind.Known;
}

export function textValue(value: DashboardText): string {
  return value.kind === DashboardTextKind.Known ? value.value : "";
}

export function formatAccessDate({
  vault,
  value,
}: {
  readonly vault: VaultState;
  readonly value: string;
}): string {
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
  return new Intl.DateTimeFormat(vault.locale, DateTimeFormatArgs).format(date);
}

export function lastUsedLabel({
  vault,
  value,
}: {
  readonly vault: VaultState;
  readonly value: DashboardTimestamp;
}): string {
  if (value.kind === DashboardTimestampKind.Known) {
    const formatAccessDateArgs: Parameters<typeof formatAccessDate>[0] = {
      vault,
      value: value.value,
    };
    return formatAccessDate(formatAccessDateArgs);
  }
  return value.kind === DashboardTimestampKind.NotYetObserved
    ? vault.t(I18N_KEYS.DevicesAccessNotUsedYet)
    : vault.t(I18N_KEYS.DevicesAccessUnknownLegacy);
}

export function isPasskeyProtection(
  protection: DeviceAccessProtectionKind,
): boolean {
  return (
    protection === DeviceAccessProtectionKind.PasskeyStandard ||
    protection === DeviceAccessProtectionKind.PasskeyAntiHacker
  );
}

export function protectionLabel({
  vault,
  protection,
}: {
  readonly vault: VaultState;
  readonly protection: DeviceAccessProtectionKind;
}): string {
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

export function identityStateLabel({
  vault,
  state,
}: {
  readonly vault: VaultState;
  readonly state: DeviceAccessIdentityState;
}): string {
  if (state === DeviceAccessIdentityState.Unlocked) {
    return vault.t(I18N_KEYS.DevicesAccessIdentityUnlocked);
  }
  return state === DeviceAccessIdentityState.Locked
    ? vault.t(I18N_KEYS.DevicesAccessIdentityLocked)
    : vault.t(I18N_KEYS.DevicesAccessIdentityMissing);
}

/**
 * The short stage name used by the chain nodes. The first link is whatever the
 * person actually presents, so it follows the protection kind. An unprepared
 * browser has not chosen yet — passkey and PIN setup are both still ahead — so
 * that stage stays generic instead of promising a passkey.
 */
export function stageLabel({
  vault,
  stage,
  protection,
}: {
  readonly vault: VaultState;
  readonly stage: AccessChainStage;
  readonly protection: DeviceAccessProtectionKind;
}): string {
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
  return isPasskeyProtection(protection)
    ? vault.t(I18N_KEYS.DevicesAccessStagePasskey)
    : vault.t(I18N_KEYS.DevicesAccessStageUnlock);
}

/** A companion session's identity belongs to the paired device, not here. */
export function deviceKeyTitle({
  vault,
  protection,
}: {
  readonly vault: VaultState;
  readonly protection: DeviceAccessProtectionKind;
}): string {
  return protection === DeviceAccessProtectionKind.CompanionSession
    ? vault.t(I18N_KEYS.DevicesAccessCompanionIdentity)
    : vault.t(I18N_KEYS.DevicesAccessThisDevice);
}

export function panelTitle({
  vault,
  stage,
  protection,
}: {
  readonly vault: VaultState;
  readonly stage: AccessChainStage;
  readonly protection: DeviceAccessProtectionKind;
}): string {
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
  const protectionLabelArgs: Parameters<typeof protectionLabel>[0] = {
    vault,
    protection,
  };
  return protectionLabel(protectionLabelArgs);
}

/**
 * A recoverable passkey identity is re-derived from the passkey each unlock and
 * has no stored key material; high-security and PIN modes keep the key wrapped
 * in this browser. Saying "wrapped" for all of them would be untrue.
 */
function deviceKeyDescription({
  vault,
  protection,
}: {
  readonly vault: VaultState;
  readonly protection: DeviceAccessProtectionKind;
}): string {
  if (protection === DeviceAccessProtectionKind.CompanionSession) {
    return vault.t(I18N_KEYS.DevicesAccessThisBrowserCompanionDesc);
  }
  return protection === DeviceAccessProtectionKind.PasskeyStandard
    ? vault.t(I18N_KEYS.DevicesAccessDeviceKeyPanelDescDerived)
    : vault.t(I18N_KEYS.DevicesAccessDeviceKeyPanelDesc);
}

export function panelDescription({
  vault,
  stage,
  protection,
}: {
  readonly vault: VaultState;
  readonly stage: AccessChainStage;
  readonly protection: DeviceAccessProtectionKind;
}): string {
  if (stage === AccessChainStage.DeviceKey) {
    const deviceKeyDescriptionArgs: Parameters<typeof deviceKeyDescription>[0] =
      { vault, protection };
    return deviceKeyDescription(deviceKeyDescriptionArgs);
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

export function verifiedVaultsLabel({
  vault,
  vaults,
}: {
  readonly vault: VaultState;
  readonly vaults: readonly VaultAccessView[];
}): string {
  const tArgs: Parameters<typeof vault.t>[0] = {
    key: I18N_KEYS.DevicesAccessVerifiedOfTotal,
    replacements: {
      verified: String(vaults.filter((entry) => entry.verified).length),
      total: String(vaults.length),
    },
  };
  return vault.t(tArgs);
}

function verifiedVaultsSummary({
  vault,
  vaults,
}: {
  readonly vault: VaultState;
  readonly vaults: readonly VaultAccessView[];
}): string {
  const tArgs2: Parameters<typeof vault.t>[0] = {
    key: I18N_KEYS.DevicesAccessVerifiedSummary,
    replacements: {
      verified: String(vaults.filter((entry) => entry.verified).length),
      total: String(vaults.length),
    },
  };
  return vault.t(tArgs2);
}

function identifierFrom(value: DashboardText): AccessNodeDetail {
  return value.kind === DashboardTextKind.Known
    ? { kind: AccessNodeDetailKind.Identifier, value: value.value }
    : { kind: AccessNodeDetailKind.Absent };
}

/**
 * The node caption already names the stage, so the title names the specific
 * thing at that stage: the passkey a manager holds, or who else could present
 * this credential when nothing is stored.
 */
function unlockNodeTitle({
  vault,
  protection,
  passkeyName,
}: {
  readonly vault: VaultState;
  readonly protection: DeviceAccessProtectionKind;
  readonly passkeyName: DashboardText;
}): string {
  if (protection === DeviceAccessProtectionKind.PinOrPassphrase) {
    return vault.t(I18N_KEYS.DevicesAccessPinNodeTitle);
  }
  if (protection === DeviceAccessProtectionKind.CompanionSession) {
    return vault.t(I18N_KEYS.DevicesAccessSessionNodeTitle);
  }
  if (!isPasskeyProtection(protection)) {
    return vault.t(I18N_KEYS.DevicesAccessNotPrepared);
  }
  return knownText(passkeyName)
    ? textValue(passkeyName)
    : vault.t(I18N_KEYS.DevicesAccessPasskeyUnnamed);
}

/**
 * Build the three chain nodes. Each node shows at most one short identifier so
 * the relationship stays readable instead of turning into a list of key ids.
 */
export function buildAccessChainNodes({
  vault,
  input,
}: {
  readonly vault: VaultState;
  readonly input: {
    protection: DeviceAccessProtectionKind;
    passkeyName: DashboardText;
    credentialId: DashboardText;
    deviceId: DashboardText;
    vaults: readonly VaultAccessView[];
  };
}): AccessChainNode[] {
  return [
    {
      stage: AccessChainStage.Unlock,
      caption: (() => {
        const stageLabelArgs: Parameters<typeof stageLabel>[0] = {
          vault,
          stage: AccessChainStage.Unlock,
          protection: input.protection,
        };
        return stageLabel(stageLabelArgs);
      })(),
      title: (() => {
        const unlockNodeTitleArgs: Parameters<typeof unlockNodeTitle>[0] = {
          vault,
          protection: input.protection,
          passkeyName: input.passkeyName,
        };
        return unlockNodeTitle(unlockNodeTitleArgs);
      })(),
      detail: isPasskeyProtection(input.protection)
        ? identifierFrom(input.credentialId)
        : { kind: AccessNodeDetailKind.Absent },
      incoming: { kind: AccessChainLinkKind.Origin },
    },
    {
      stage: AccessChainStage.DeviceKey,
      caption: (() => {
        const stageLabelArgs2: Parameters<typeof stageLabel>[0] = {
          vault,
          stage: AccessChainStage.DeviceKey,
          protection: input.protection,
        };
        return stageLabel(stageLabelArgs2);
      })(),
      title: (() => {
        const deviceKeyTitleArgs: Parameters<typeof deviceKeyTitle>[0] = {
          vault,
          protection: input.protection,
        };
        return deviceKeyTitle(deviceKeyTitleArgs);
      })(),
      detail: identifierFrom(input.deviceId),
      incoming: {
        kind: AccessChainLinkKind.Relation,
        label: vault.t(I18N_KEYS.DevicesAccessLinkUnlocks),
      },
    },
    (() => {
      const vaultsNodeArgs: Parameters<typeof vaultsNode>[0] = {
        vault,
        protection: input.protection,
        vaults: input.vaults,
      };
      return vaultsNode(vaultsNodeArgs);
    })(),
  ];
}

/**
 * A vault is only known to be reachable from this device key once that key
 * actually opened it, so the node names verified vaults only. With rows present
 * and none verified the relation drops the access claim; with no rows at all it
 * keeps the verb, because then it describes the shape of the chain to come.
 */
function vaultsNode({
  vault,
  protection,
  vaults,
}: {
  readonly vault: VaultState;
  readonly protection: DeviceAccessProtectionKind;
  readonly vaults: readonly VaultAccessView[];
}): AccessChainNode {
  const verified = vaults.filter((entry) => entry.verified);
  return {
    stage: AccessChainStage.Vaults,
    caption: (() => {
      const stageLabelArgs3: Parameters<typeof stageLabel>[0] = {
        vault,
        stage: AccessChainStage.Vaults,
        protection,
      };
      return stageLabel(stageLabelArgs3);
    })(),
    title: (() => {
      const vaultsNodeTitleArgs: Parameters<typeof vaultsNodeTitle>[0] = {
        vault,
        vaults,
        verified,
      };
      return vaultsNodeTitle(vaultsNodeTitleArgs);
    })(),
    detail:
      vaults.length === 0
        ? { kind: AccessNodeDetailKind.Absent }
        : {
            kind: AccessNodeDetailKind.Summary,
            value: (() => {
              const verifiedVaultsSummaryArgs: Parameters<
                typeof verifiedVaultsSummary
              >[0] = { vault, vaults };
              return verifiedVaultsSummary(verifiedVaultsSummaryArgs);
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

/** One link, one name: further verified vaults become a count, not a list. */
function vaultsNodeTitle({
  vault,
  vaults,
  verified,
}: {
  readonly vault: VaultState;
  readonly vaults: readonly VaultAccessView[];
  readonly verified: readonly VaultAccessView[];
}): string {
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
