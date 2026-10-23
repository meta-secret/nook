import { err, ok, type Result } from "neverthrow";
import {
  ExternalDeviceIdentityAuthorizationMode,
  set_vault_session_locked,
  VaultCompanionUnlockDecision,
} from "$app-wasm";
import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";
import { ExtensionPairedVaultIdentityStatusMessageStatus as PairedStatus } from "$web-shared/extension/paired-vault-identity-status";
import {
  PAIRED_EXTENSION_UNLOCK_RETRY_MS,
  PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS,
} from "$lib/app/paired-extension-unlock-delivery";
import {
  extensionConnectionBrowser as connectionBrowser,
  type ExtensionConnectRequest,
  type PairedExtensionIdentityDiscoveryResult,
} from "$lib/extension/connect";
import type { VaultState } from "$lib/vault.svelte";

export type ExtensionIdentityAdoptionRequest = {
  readonly vault: VaultState;
  readonly request: ExtensionConnectRequest;
  readonly mode: ExternalDeviceIdentityAuthorizationMode;
};

/** Unlocks this page's identity with the one a paired or connecting
 * extension hands over. The mode decides whether a vault session follows. */
export function adoptExtensionIdentity({
  vault,
  request,
  mode,
}: ExtensionIdentityAdoptionRequest): Promise<boolean> {
  const authorization: Parameters<
    VaultState["authorizeWithExternalDeviceIdentity"]
  >[0] = {
    adopt: (manager) => {
      const adoption: Parameters<
        typeof connectionBrowser.adoptExtensionIdentity
      >[0] = { manager, request };
      return connectionBrowser.adoptExtensionIdentity(adoption);
    },
    mode,
  };
  return vault.authorizeWithExternalDeviceIdentity(authorization);
}

/** The paired extension as seen from the page: it reports its state for a
 * vault and hands over a single-use identity request while it is unlocked. */
export type PairedExtensionIdentitySource = {
  discoverAdmittedPairedExtensionIdentity(
    storeId: string,
  ): Promise<PairedExtensionIdentityDiscoveryResult>;
  requestPairedExtensionUnlock(storeId: string): Promise<boolean>;
};

export type PairedExtensionIdentityUnlockRequest = {
  readonly vault: VaultState;
  /** The vault the extension is paired for on this page. */
  readonly storeId: string;
  readonly source: PairedExtensionIdentitySource;
};

/** Which vault a paired extension unlock asks for. */
export enum PairedIdentityUnlockScope {
  /** The vault this page has open or selected. */
  PageVault = "page-vault",
  /** A vault of the card the unlock came from. */
  CardVault = "card-vault",
}

/** An unlock of the identity whose key the paired extension holds. From a
 * card while another identity is in use, that identity is left first, as
 * switching to an identity stored on this browser does. */
export type PairedIdentityUnlockTarget =
  | { readonly scope: PairedIdentityUnlockScope.PageVault }
  | {
      readonly scope: PairedIdentityUnlockScope.CardVault;
      readonly storeId: string;
      readonly leavesCurrentIdentity: boolean;
    };

/**
 * Unlock on a card whose key the paired extension holds: the identity
 * unlocks alone, as a passkey on this browser unlocks its own card, and no
 * vault opens. Each unlock takes a fresh request from the extension; one is
 * never kept for later, because the extension accepts it once.
 */
export class PairedExtensionIdentityUnlock {
  constructor(private readonly request: PairedExtensionIdentityUnlockRequest) {}

  /** True once the identity is unlocked; a failure is shown on the page.
   * Call it straight from the person's click: see the unlock request below. */
  async unlock(): Promise<boolean> {
    const { vault, storeId, source } = this.request;
    // The person chose the identity alone: no vault opens by itself from now
    // until they open one, including from the extension's automatic resume.
    set_vault_session_locked(true);
    // Sent before anything is awaited: the extension opens its unlock panel
    // only within the person's gesture. It is read only if it is locked.
    const unlockRequest = source.requestPairedExtensionUnlock(storeId);
    const handoff = await this.freshRequest(unlockRequest);
    if (handoff.isErr()) {
      vault.errorMsg = vault.t(handoff.error);
      return false;
    }
    const adoption: ExtensionIdentityAdoptionRequest = {
      vault,
      request: handoff.value,
      mode: ExternalDeviceIdentityAuthorizationMode.IdentityOnly,
    };
    return adoptExtensionIdentity(adoption);
  }

  /** The extension's current request; while it is locked, waits within the
   * paired unlock timeout for the person to unlock it. */
  private async freshRequest(
    unlockRequest: Promise<boolean>,
  ): Promise<Result<ExtensionConnectRequest, I18nKey>> {
    const { vault, storeId, source } = this.request;
    const deadline = Date.now() + PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const admitted =
        await source.discoverAdmittedPairedExtensionIdentity(storeId);
      if (admitted.isErr()) return err(admitted.error.translationKey);
      const decision = vault.clientPolicy.companion_unlock_decision(
        admitted.value.canonicalStatus,
      );
      const discovery = admitted.value.discovery;
      if (decision === VaultCompanionUnlockDecision.WebsiteDevice)
        return err(I18N_KEYS.ExtensionConnectIdentityHandoffFailed);
      if (discovery.status === PairedStatus.Unlocked)
        return ok(discovery.request);
      if (!(await unlockRequest))
        return err(I18N_KEYS.ExtensionConnectMessagingUnavailable);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, PAIRED_EXTENSION_UNLOCK_RETRY_MS);
      });
    }
    // The person did not unlock it in time; the extension stays as it was.
    return err(I18N_KEYS.ExtensionConnectPairedUnlockTimedOut);
  }
}
