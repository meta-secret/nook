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

export function formatAccessDate(vault: VaultState, value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return vault.t(I18N_KEYS.DevicesAccessUnknown);
  }
  return new Intl.DateTimeFormat(vault.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function lastUsedLabel(
  vault: VaultState,
  value: DashboardTimestamp,
): string {
  if (value.kind === DashboardTimestampKind.Known) {
    return formatAccessDate(vault, value.value);
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

export function protectionLabel(
  vault: VaultState,
  protection: DeviceAccessProtectionKind,
): string {
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

export function identityStateLabel(
  vault: VaultState,
  state: DeviceAccessIdentityState,
): string {
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
export function stageLabel(
  vault: VaultState,
  stage: AccessChainStage,
  protection: DeviceAccessProtectionKind,
): string {
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
function deviceKeyTitle(
  vault: VaultState,
  protection: DeviceAccessProtectionKind,
): string {
  return protection === DeviceAccessProtectionKind.CompanionSession
    ? vault.t(I18N_KEYS.DevicesAccessCompanionIdentity)
    : vault.t(I18N_KEYS.DevicesAccessThisDevice);
}

export function panelTitle(
  vault: VaultState,
  stage: AccessChainStage,
  protection: DeviceAccessProtectionKind,
): string {
  if (stage === AccessChainStage.DeviceKey) {
    return protection === DeviceAccessProtectionKind.CompanionSession
      ? vault.t(I18N_KEYS.DevicesAccessCompanionIdentity)
      : vault.t(I18N_KEYS.DevicesAccessDeviceAgeKey);
  }
  if (stage === AccessChainStage.Vaults) {
    return vault.t(I18N_KEYS.DevicesAccessVaultRelationships);
  }
  return protectionLabel(vault, protection);
}

export function panelDescription(
  vault: VaultState,
  stage: AccessChainStage,
  protection: DeviceAccessProtectionKind,
): string {
  if (stage === AccessChainStage.DeviceKey) {
    return protection === DeviceAccessProtectionKind.CompanionSession
      ? vault.t(I18N_KEYS.DevicesAccessThisBrowserCompanionDesc)
      : vault.t(I18N_KEYS.DevicesAccessDeviceKeyPanelDesc);
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

export function verifiedVaultsLabel(
  vault: VaultState,
  vaults: readonly VaultAccessView[],
): string {
  return vault.t(I18N_KEYS.DevicesAccessVerifiedOfTotal, {
    verified: String(vaults.filter((entry) => entry.verified).length),
    total: String(vaults.length),
  });
}

function verifiedVaultsSummary(
  vault: VaultState,
  vaults: readonly VaultAccessView[],
): string {
  return vault.t(I18N_KEYS.DevicesAccessVerifiedSummary, {
    verified: String(vaults.filter((entry) => entry.verified).length),
    total: String(vaults.length),
  });
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
function unlockNodeTitle(
  vault: VaultState,
  protection: DeviceAccessProtectionKind,
  passkeyName: DashboardText,
): string {
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
export function buildAccessChainNodes(
  vault: VaultState,
  input: {
    protection: DeviceAccessProtectionKind;
    passkeyName: DashboardText;
    credentialId: DashboardText;
    deviceId: DashboardText;
    vaults: readonly VaultAccessView[];
  },
): AccessChainNode[] {
  return [
    {
      stage: AccessChainStage.Unlock,
      caption: stageLabel(vault, AccessChainStage.Unlock, input.protection),
      title: unlockNodeTitle(vault, input.protection, input.passkeyName),
      detail: isPasskeyProtection(input.protection)
        ? identifierFrom(input.credentialId)
        : { kind: AccessNodeDetailKind.Absent },
      incoming: { kind: AccessChainLinkKind.Origin },
    },
    {
      stage: AccessChainStage.DeviceKey,
      caption: stageLabel(vault, AccessChainStage.DeviceKey, input.protection),
      title: deviceKeyTitle(vault, input.protection),
      detail: identifierFrom(input.deviceId),
      incoming: {
        kind: AccessChainLinkKind.Relation,
        label: vault.t(I18N_KEYS.DevicesAccessLinkUnlocks),
      },
    },
    vaultsNode(vault, input.protection, input.vaults),
  ];
}

/**
 * A vault is only known to be reachable from this device key once that key
 * actually opened it, so the node names verified vaults only. With rows present
 * and none verified the relation drops the access claim; with no rows at all it
 * keeps the verb, because then it describes the shape of the chain to come.
 */
function vaultsNode(
  vault: VaultState,
  protection: DeviceAccessProtectionKind,
  vaults: readonly VaultAccessView[],
): AccessChainNode {
  const verified = vaults.filter((entry) => entry.verified);
  return {
    stage: AccessChainStage.Vaults,
    caption: stageLabel(vault, AccessChainStage.Vaults, protection),
    title: vaultsNodeTitle(vault, vaults, verified),
    detail:
      vaults.length === 0
        ? { kind: AccessNodeDetailKind.Absent }
        : {
            kind: AccessNodeDetailKind.Summary,
            value: verifiedVaultsSummary(vault, vaults),
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
function vaultsNodeTitle(
  vault: VaultState,
  vaults: readonly VaultAccessView[],
  verified: readonly VaultAccessView[],
): string {
  if (vaults.length === 0) {
    return vault.t(I18N_KEYS.DevicesAccessNoVaultsShort);
  }
  if (verified.length === 0) {
    return vault.t(I18N_KEYS.DevicesAccessNoVerifiedVaultsShort);
  }
  const [primary, ...rest] = verified;
  return rest.length === 0
    ? primary.label
    : vault.t(I18N_KEYS.DevicesAccessVerifiedPlusMore, {
        label: primary.label,
        count: String(rest.length),
      });
}
