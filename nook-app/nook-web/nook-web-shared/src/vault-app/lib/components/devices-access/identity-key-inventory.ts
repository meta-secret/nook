import {
  DeviceAccessProtectionKind,
  NookIdentityLocalAccessKind,
  PasskeyKeeperKind,
} from "$app-wasm";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import {
  type DashboardView,
  DashboardTextKind,
} from "../devices-access-dashboard-state";
import { AccessChainStage } from "./access-chain";
import type { IdentityDirectoryEntry } from "./identity-directory-view";
import { buildIdentityAccessCards } from "./identity-access-list";
import { keeperLabel } from "./passkey-evidence-labels";

export enum IdentityKeyInventoryRowKind {
  Protector = "protector",
  AppKey = "app-key",
}

export enum IdentityKeyInventoryActionKind {
  InspectCurrentBrowser = "inspect-current-browser",
  Unavailable = "unavailable",
}

export type IdentityKeyInventoryRow = {
  readonly key: string;
  readonly kind: IdentityKeyInventoryRowKind;
  readonly title: string;
  readonly typeLabel: string;
  readonly protector: string;
  readonly lastUsed: string;
  readonly stage: AccessChainStage;
  readonly action: IdentityKeyInventoryActionKind;
};

type IdentityKeyInventoryRequest = {
  readonly vault: VaultState;
  readonly identity: IdentityDirectoryEntry;
  readonly view: DashboardView;
};

type PasskeyProtectorRequest = {
  readonly vault: VaultState;
  readonly view: DashboardView;
};

function passkeyProtector({ vault, view }: PasskeyProtectorRequest): string {
  if (view.keeper !== PasskeyKeeperKind.Unknown) {
    const keeperArgs: Parameters<typeof keeperLabel>[0] = {
      vault,
      value: view.keeper,
    };
    return keeperLabel(keeperArgs);
  }
  return vault.t(I18N_KEYS.DevicesAccessThisBrowser);
}

export function buildIdentityKeyInventory({
  vault,
  identity,
  view,
}: IdentityKeyInventoryRequest): readonly IdentityKeyInventoryRow[] {
  const rows: IdentityKeyInventoryRow[] = [];
  if (
    identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser &&
    view.protection !== DeviceAccessProtectionKind.Missing
  ) {
    const cardArgs: Parameters<typeof buildIdentityAccessCards>[0] = {
      vault,
      view,
    };
    const protector = buildIdentityAccessCards(cardArgs)[0];
    if (protector) {
      const passkeyProtectorArgs: PasskeyProtectorRequest = { vault, view };
      rows.push({
        key: `protector:${protector.key}`,
        kind: IdentityKeyInventoryRowKind.Protector,
        title: protector.title,
        typeLabel: protector.typeLabel,
        protector: passkeyProtector(passkeyProtectorArgs),
        lastUsed: protector.lastUsedLabel,
        stage: protector.stage,
        action: IdentityKeyInventoryActionKind.InspectCurrentBrowser,
      });
    }
  }

  for (const member of identity.members) {
    const isCurrent = member.currentBrowser;
    rows.push({
      key: `app:${member.appId}`,
      kind: IdentityKeyInventoryRowKind.AppKey,
      title:
        member.label.kind === DashboardTextKind.Known
          ? member.label.value
          : vault.t(
              isCurrent
                ? I18N_KEYS.DevicesAccessThisBrowserAppKey
                : I18N_KEYS.DevicesAccessOtherAppKey,
            ),
      typeLabel: vault.t(I18N_KEYS.DevicesAccessKeyTypeAppKey),
      protector: vault.t(
        isCurrent
          ? I18N_KEYS.DevicesAccessThisBrowser
          : I18N_KEYS.DevicesAccessOtherInstallation,
      ),
      lastUsed: vault.t(I18N_KEYS.DevicesAccessUnknown),
      stage: AccessChainStage.DeviceKey,
      action: isCurrent
        ? IdentityKeyInventoryActionKind.InspectCurrentBrowser
        : IdentityKeyInventoryActionKind.Unavailable,
    });
  }
  return rows;
}
