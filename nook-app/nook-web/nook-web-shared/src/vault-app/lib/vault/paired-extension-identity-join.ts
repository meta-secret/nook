import { err, ok, type Result } from "neverthrow";
import { VaultIdentityKeySource } from "$app-wasm";
import { DeviceJoinMounts } from "$lib/components/add-device/device-join-mounts";
import { IdentityStandingPresentation } from "$lib/components/identity-control/identity-standing";
import {
  extensionConnectionBrowser,
  InstalledExtensionRuntimeKind,
  type ExtensionConnectRequest,
  type PairedExtensionDiscoveryFailure,
  type PairedExtensionIdentityDiscovery,
} from "$lib/extension/connect";
import { ExtensionConnectScope } from "$web-shared/extension/extension-connect-scope";
import { ExtensionPairingDeliveryKind } from "$lib/extension/extension-pairing-delivery";
import { ExtensionVaultApproval } from "$lib/extension/vault-approval";
import { ExtensionPairedVaultIdentityStatusMessageStatus as PairedStatus } from "$web-shared/extension/paired-vault-identity-status";
import { browserLogRuntime } from "$lib/runtime/log";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import type { VaultState } from "$lib/vault.svelte";
import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";

const log = browserLogRuntime.createLogger("vault-paired-extension-identity");

export enum PairedExtensionIdentityJoinOutcome {
  /** Nothing to do: no paired extension waits outside the identity. */
  Unchanged = "unchanged",
  /** The extension received the identity invite. */
  Invited = "invited",
}

/** The paired extension's state for the open vault. */
export type PairedExtensionDiscover = (
  storeId: string,
) => Promise<
  Result<PairedExtensionIdentityDiscovery, PairedExtensionDiscoveryFailure>
>;

/** Approves the extension for the open vault again and delivers the grant;
 * the grant now carries the identity invite. */
export type PairedExtensionApprover = (
  request: ExtensionConnectRequest,
) => Promise<Result<ExtensionPairingDeliveryKind.Delivered, I18nKey>>;

export type PairedExtensionIdentityJoinRequest = {
  readonly vault: VaultState;
  /** An extension is installed beside this page. */
  readonly extensionInstalled: () => boolean;
  readonly discover: PairedExtensionDiscover;
  /** Installations the open vault authorizes now. */
  readonly vaultRoster: () => readonly string[];
  readonly approve: PairedExtensionApprover;
};

type PairedExtensionApproval = {
  readonly vault: VaultState;
  readonly connect: ExtensionConnectRequest;
};

/**
 * An extension approved for a vault while its identity had no cloud copy
 * joined only that vault: its approval carried no identity invite. Once
 * this browser's own member key is open and the identity has a cloud copy,
 * the approval runs again, so the extension receives the invite it went
 * without and joins the identity, as its approval meant. Only an extension
 * the open vault still authorizes, holding the sync-provider scope that
 * approval granted, is invited.
 */
export class PairedExtensionIdentityJoin {
  constructor(private readonly request: PairedExtensionIdentityJoinRequest) {}

  /** This page's join, through the extension installed beside it. */
  static forPage(vault: VaultState): PairedExtensionIdentityJoin {
    const request: PairedExtensionIdentityJoinRequest = {
      vault,
      extensionInstalled: () =>
        extensionConnectionBrowser.readInstalledExtensionRuntimeId().kind ===
        InstalledExtensionRuntimeKind.Installed,
      discover: async (storeId) =>
        (
          await extensionConnectionBrowser.discoverAdmittedPairedExtensionIdentity(
            storeId,
          )
        ).map((admitted) => admitted.discovery),
      vaultRoster: () => vault.vaultMembers.map((member) => member.deviceId),
      approve: (connect) => {
        const approval: PairedExtensionApproval = { vault, connect };
        return PairedExtensionIdentityJoin.approve(approval);
      },
    };
    return new PairedExtensionIdentityJoin(request);
  }

  private static async approve({
    vault,
    connect,
  }: PairedExtensionApproval): Promise<
    Result<ExtensionPairingDeliveryKind.Delivered, I18nKey>
  > {
    const approval = new ExtensionVaultApproval(vault, connect);
    try {
      const authorized = await approval.authorize();
      if (authorized.isErr()) return err(authorized.error.translationKey);
      const prepared = await approval.prepareAuthorizedGrant();
      if (prepared.isErr()) return err(prepared.error.translationKey);
      const delivered = await approval.deliver(prepared.value);
      if (delivered.isErr()) return err(delivered.error.translationKey);
      switch (delivered.value.kind) {
        case ExtensionPairingDeliveryKind.Delivered:
          return ok(ExtensionPairingDeliveryKind.Delivered);
        case ExtensionPairingDeliveryKind.MessagingUnavailable:
          return err(I18N_KEYS.ExtensionConsentMessagingUnavailable);
        case ExtensionPairingDeliveryKind.Rejected:
          return err(I18N_KEYS.ExtensionConsentGrantRejected);
      }
    } finally {
      approval.releaseAuthorization();
    }
  }

  async run(): Promise<Result<PairedExtensionIdentityJoinOutcome, I18nKey>> {
    const { vault, extensionInstalled, discover, vaultRoster, approve } =
      this.request;
    const unchanged = ok(PairedExtensionIdentityJoinOutcome.Unchanged);
    // Only a member can invite; the extension's own key is not one yet.
    if (vault.identityKeySource !== VaultIdentityKeySource.ThisBrowser)
      return unchanged;
    if (vault.activeVault.kind !== ActiveVaultKind.Open) return unchanged;
    const storeId = vault.activeVault.storeId.trim();
    const snapshot = vault.identityControl.snapshot;
    if (snapshot === false) return unchanged;
    if (!new IdentityStandingPresentation(snapshot).isMember())
      return unchanged;
    const mountRequest: ConstructorParameters<typeof DeviceJoinMounts>[0] = {
      mounts: vault.identityControl.mounts,
      replication: vault.vaultArchitecture.replication_type,
    };
    if (new DeviceJoinMounts(mountRequest).compatible.length === 0)
      return unchanged;
    // No extension beside this page: nothing is paired.
    if (!extensionInstalled()) return unchanged;
    const discovered = await discover(storeId);
    if (discovered.isErr()) return err(discovered.error.translationKey);
    const discovery = discovered.value;
    // A locked extension is invited the next time both are open.
    if (discovery.status !== PairedStatus.Unlocked) return unchanged;
    const connect = discovery.request;
    const isMember = snapshot.members.some(
      (member) => member.appId === connect.deviceId,
    );
    // An extension removed from the vault is never approved again here.
    const authorized = vaultRoster().includes(connect.deviceId);
    const sharesProviders = connect.scopes.includes(
      ExtensionConnectScope.SyncProviderCredentials,
    );
    if (isMember || !authorized || !sharesProviders) return unchanged;
    const approved = await approve(connect);
    if (approved.isErr()) return err(approved.error);
    log.info("paired extension invited into the identity");
    return ok(PairedExtensionIdentityJoinOutcome.Invited);
  }
}
