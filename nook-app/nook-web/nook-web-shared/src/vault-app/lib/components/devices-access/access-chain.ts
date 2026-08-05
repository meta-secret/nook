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

/** Independent evidence categories available beneath the relationship view. */
export enum AccessChainStage {
  Unlock = "unlock",
  Vaults = "vaults",
}

export const ACCESS_CHAIN_STAGES: readonly AccessChainStage[] = [
  AccessChainStage.Unlock,
  AccessChainStage.Vaults,
];

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

/** A detail tab can be gone by the time a rerender settles, so say so. */
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
  if (state === DeviceAccessIdentityState.Locked) {
    return vault.t(I18N_KEYS.DevicesAccessIdentityLocked);
  }
  return vault.t(I18N_KEYS.DevicesAccessIdentityMissing);
}

export function panelTitle(
  vault: VaultState,
  stage: AccessChainStage,
  protection: DeviceAccessProtectionKind,
): string {
  if (stage === AccessChainStage.Vaults) {
    return vault.t(I18N_KEYS.DevicesAccessVaultRelationships);
  }
  if (protection === DeviceAccessProtectionKind.PinOrPassphrase) {
    return vault.t(I18N_KEYS.DevicesAccessPinNodeTitle);
  }
  return protectionLabel(vault, protection);
}

export function panelDescription(
  vault: VaultState,
  stage: AccessChainStage,
  protection: DeviceAccessProtectionKind,
): string {
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
