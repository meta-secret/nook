import {
  device_access_credential_kind,
  DeviceAccessCredentialKind,
} from "$app-wasm";
import {
  DeviceAccessProtectionKind,
  NookIdentityLocalAccessKind,
} from "$app-wasm";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { type DashboardView } from "../devices-access-dashboard-state";
import type {
  IdentityDirectoryEntry,
  IdentityMemberView,
} from "./identity-directory-view";
import { IdentityAccessPresentation } from "./identity-access-list";
import { AccessChainPresentation } from "./access-chain";
import {
  PASSKEY_CARD_SUMMARY_ABSENT,
  PasskeyCardSummaryKind,
  PasskeyCardFactKind,
  type PasskeyCardSummaryState,
} from "./passkey-card";

export enum IdentityKeyInventoryRowKind {
  Protector = "protector",
  Apps = "apps",
}

export type IdentityAppInventoryItem = {
  readonly key: string;
  readonly title: string;
  readonly relationship: string;
  readonly appId: string;
};

export type IdentityKeyInventoryRow = {
  readonly key: string;
  readonly kind: IdentityKeyInventoryRowKind;
  readonly title: string;
  readonly typeLabel: string;
  readonly lastUsed: string;
  readonly renamable: boolean;
  readonly passkeySummary: PasskeyCardSummaryState;
  readonly apps: readonly IdentityAppInventoryItem[];
};

type IdentityKeyInventoryRequest = {
  readonly vault: VaultState;
  readonly identity: IdentityDirectoryEntry;
  readonly view: DashboardView;
};

export class IdentityKeyInventory {
  constructor(private readonly request: IdentityKeyInventoryRequest) {}
  get rows(): readonly IdentityKeyInventoryRow[] {
    const { vault, identity, view } = this.request;
    const rows: IdentityKeyInventoryRow[] = [];
    const linkedApps: IdentityAppInventoryItem[] = [];
    const currentIdentity =
      identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser;
    for (const [index, member] of identity.members.entries()) {
      const isCurrent = member.currentBrowser;
      const localProtection =
        currentIdentity && isCurrent ? view.protection : member.localProtection;
      const isLocal = localProtection !== DeviceAccessProtectionKind.Missing;
      const isCompanion =
        isCurrent &&
        view.protection === DeviceAccessProtectionKind.CompanionSession;
      const fallbackTitleArgs: Parameters<typeof vault.t>[0] = {
        key: I18N_KEYS.DevicesAccessOtherAppKey,
        replacements: { count: String(index + 1) },
      };
      const appBase = {
        key: `app:${member.appId}`,
        title: member.label.displayText(() =>
          isCompanion
            ? vault.t(I18N_KEYS.DevicesAccessCompanionSession)
            : isCurrent || isLocal
              ? vault.t(I18N_KEYS.DevicesAccessThisBrowserAppKey)
              : vault.t(fallbackTitleArgs),
        ),
        appId: member.appId,
      };
      const associatedRequest: AssociatedProtectorRequest = {
        member,
        app: appBase,
      };
      const displayRequest: ProtectorAssociationDisplayRequest = {
        localProtection,
        association: member.protectionAssociation,
      };
      switch (this.displayedAssociation(displayRequest)) {
        case DeviceAccessProtectionKind.PasskeyStandard:
        case DeviceAccessProtectionKind.PasskeyAntiHacker:
        case DeviceAccessProtectionKind.PinOrPassphrase: {
          rows.push(this.associatedProtector(associatedRequest));
          continue;
        }
        case DeviceAccessProtectionKind.Missing:
        case DeviceAccessProtectionKind.CompanionSession:
          break;
      }
      if (!isLocal) {
        const linkedRelationshipArgs: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.DevicesAccessAppLinkedToIdentity,
          replacements: { identity: identity.label },
        };
        const linkedApp: IdentityAppInventoryItem = {
          ...appBase,
          relationship: vault.t(linkedRelationshipArgs),
        };
        linkedApps.push(linkedApp);
        continue;
      }

      const cardArgs: ConstructorParameters<
        typeof IdentityAccessPresentation
      >[0] = {
        vault,
        view,
      };
      const currentProtectorCards =
        currentIdentity && isCurrent
          ? new IdentityAccessPresentation(cardArgs).cards
          : [];
      const currentProtector = currentProtectorCards[0];
      const protectionLabelArgs: Parameters<
        AccessChainPresentation["protectionLabel"]
      >[0] = {
        protection: localProtection,
      };
      const [
        protectorTitle = new AccessChainPresentation(vault).protectionLabel(
          protectionLabelArgs,
        ),
      ] = [currentProtector?.title];
      const protectedRelationshipArgs: Parameters<typeof vault.t>[0] = {
        key: I18N_KEYS.DevicesAccessAppProtectedBy,
        replacements: { protection: protectorTitle },
      };
      const protectorRow: IdentityKeyInventoryRow = {
        key: `protector:${member.appId}`,
        kind: IdentityKeyInventoryRowKind.Protector,
        title: protectorTitle,
        typeLabel: ((
          ...[
            v = vault.t(
              device_access_credential_kind(localProtection) ===
                DeviceAccessCredentialKind.Passkey
                ? I18N_KEYS.DevicesAccessKeyTypePasskey
                : localProtection ===
                    DeviceAccessProtectionKind.CompanionSession
                  ? I18N_KEYS.DevicesAccessKeyTypeCompanion
                  : I18N_KEYS.DevicesAccessKeyTypePin,
            ),
          ]
        ) => v)(currentProtector?.typeLabel),
        lastUsed: ((...[v = vault.t(I18N_KEYS.DevicesAccessUnknown)]) => v)(
          currentProtector?.lastUsedLabel,
        ),
        renamable:
          Boolean(currentProtector) &&
          device_access_credential_kind(localProtection) ===
            DeviceAccessCredentialKind.Passkey,
        passkeySummary: ((...[v = PASSKEY_CARD_SUMMARY_ABSENT]) => v)(
          currentProtector?.passkeySummary,
        ),
        apps: [
          {
            ...appBase,
            relationship: vault.t(protectedRelationshipArgs),
          },
        ],
      };
      rows.push(protectorRow);
    }

    if (linkedApps.length > 0 || rows.length === 0) {
      const appsTitleArgs: Parameters<typeof vault.t>[0] = {
        key: I18N_KEYS.DevicesAccessAppsForIdentity,
        replacements: { identity: identity.label },
      };
      const appsRow: IdentityKeyInventoryRow = {
        key: `apps:${identity.identityId}`,
        kind: IdentityKeyInventoryRowKind.Apps,
        title: vault.t(appsTitleArgs),
        typeLabel: vault.t(I18N_KEYS.DevicesAccessAppsHeading),
        lastUsed: vault.t(I18N_KEYS.DevicesAccessUnknown),
        renamable: false,
        passkeySummary: PASSKEY_CARD_SUMMARY_ABSENT,
        apps: linkedApps,
      };
      rows.push(appsRow);
    }
    return rows;
  }

  private displayedAssociation(
    request: ProtectorAssociationDisplayRequest,
  ): DeviceAccessProtectionKind {
    switch (request.localProtection) {
      case DeviceAccessProtectionKind.Missing:
      case DeviceAccessProtectionKind.CompanionSession:
        return request.association;
      case DeviceAccessProtectionKind.PasskeyStandard:
      case DeviceAccessProtectionKind.PasskeyAntiHacker:
      case DeviceAccessProtectionKind.PinOrPassphrase:
        return DeviceAccessProtectionKind.Missing;
    }
  }

  private associatedProtector(
    request: AssociatedProtectorRequest,
  ): IdentityKeyInventoryRow {
    const { vault } = this.request;
    const { member, app } = request;
    const protectionLabelRequest: Parameters<
      AccessChainPresentation["protectionLabel"]
    >[0] = {
      protection: member.protectionAssociation,
    };
    const modeLabel = new AccessChainPresentation(vault).protectionLabel(
      protectionLabelRequest,
    );
    let title = modeLabel;
    let typeLabel = vault.t(I18N_KEYS.DevicesAccessKeyTypePin);
    let passkeySummary: PasskeyCardSummaryState = PASSKEY_CARD_SUMMARY_ABSENT;
    switch (member.protectionAssociation) {
      case DeviceAccessProtectionKind.PasskeyStandard:
      case DeviceAccessProtectionKind.PasskeyAntiHacker:
        title = member.associatedPasskeyName.displayText(() =>
          vault.t(I18N_KEYS.DevicesAccessPasskeyUnnamed),
        );
        typeLabel = vault.t(I18N_KEYS.DevicesAccessKeyTypePasskey);
        passkeySummary = {
          kind: PasskeyCardSummaryKind.Present,
          summary: {
            title,
            typeLabel,
            modeLabel,
            facts: [
              {
                kind: PasskeyCardFactKind.Fingerprint,
                label: vault.t(I18N_KEYS.DevicesAccessCredentialId),
                value: member.associatedPasskeyFingerprint.displayText(() =>
                  vault.t(I18N_KEYS.DevicesAccessUnknown),
                ),
              },
              {
                kind: PasskeyCardFactKind.Keeper,
                label: vault.t(I18N_KEYS.DevicesAccessKeeperLabel),
                value: vault.t(I18N_KEYS.DevicesAccessKeeperUnknown),
              },
              {
                kind: PasskeyCardFactKind.Created,
                label: vault.t(I18N_KEYS.DevicesAccessCreated),
                value: vault.t(I18N_KEYS.DevicesAccessUnknownLegacy),
              },
              {
                kind: PasskeyCardFactKind.LastUsed,
                label: vault.t(I18N_KEYS.DevicesAccessLastUsedColumn),
                value: vault.t(I18N_KEYS.DevicesAccessUnknownLegacy),
              },
            ],
          },
        };
        break;
      case DeviceAccessProtectionKind.PinOrPassphrase:
      case DeviceAccessProtectionKind.Missing:
      case DeviceAccessProtectionKind.CompanionSession:
        break;
    }
    const relationshipRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessAppProtectedBy,
      replacements: { protection: title },
    };
    return {
      key: `protector:${member.appId}`,
      kind: IdentityKeyInventoryRowKind.Protector,
      title,
      typeLabel,
      lastUsed: vault.t(I18N_KEYS.DevicesAccessUnknownLegacy),
      renamable: false,
      passkeySummary,
      apps: [{ ...app, relationship: vault.t(relationshipRequest) }],
    };
  }
}

type AssociatedProtectorRequest = {
  readonly member: IdentityMemberView;
  readonly app: Omit<IdentityAppInventoryItem, "relationship">;
};

type ProtectorAssociationDisplayRequest = {
  readonly localProtection: DeviceAccessProtectionKind;
  readonly association: DeviceAccessProtectionKind;
};
