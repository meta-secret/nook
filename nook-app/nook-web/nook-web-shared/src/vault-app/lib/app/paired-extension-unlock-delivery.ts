import type { Result } from "neverthrow";
import { ExtensionPairedVaultIdentityStatusMessageStatus } from "$web-shared/extension/paired-vault-identity-status";
import type { PairedExtensionDiscoveryFailure } from "$lib/extension/connect";
import type { PairedExtensionResumeStatus } from "./app-interaction-types";

export enum PairedExtensionUnlockDeliveryKind {
  NotRequested = "not-requested",
  Requested = "requested",
}

export type PairedExtensionUnlockDeliveryState =
  | { readonly kind: PairedExtensionUnlockDeliveryKind.NotRequested }
  | {
      readonly kind: PairedExtensionUnlockDeliveryKind.Requested;
      readonly delivery: Promise<boolean>;
    };

export type PairedExtensionUnlockRequester = {
  requestPairedExtensionUnlock(storeId: string): Promise<boolean>;
};

export type PairedExtensionUnlockDeliveryRequest = {
  readonly shouldRequest: boolean;
  readonly storeId?: string;
  readonly requester: PairedExtensionUnlockRequester;
};

export type PairedExtensionUnlockPollRequest = {
  readonly storeId: string;
  readonly isAuthenticated: () => boolean;
  readonly resumePairedVault: (
    storeId: string,
  ) => Promise<
    Result<PairedExtensionResumeStatus, PairedExtensionDiscoveryFailure>
  >;
};

/** What a paired extension reports while another flow owns this vault: an
 * extension holding a different vault counts as unavailable here. */
export function pairedResumeStatusWhileBusy(
  status: ExtensionPairedVaultIdentityStatusMessageStatus,
): PairedExtensionResumeStatus {
  return status ===
    ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
    ? ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
    : status;
}

/** A paired extension that is not unlocked yet is asked again shortly;
 * until then it reads as locked, or otherwise as unavailable. */
export function pairedResumeStatusWhileRetrying(
  status: ExtensionPairedVaultIdentityStatusMessageStatus,
): PairedExtensionResumeStatus {
  return status === ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    ? ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    : ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable;
}

const PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS = 30_000;
const PAIRED_EXTENSION_UNLOCK_RETRY_MS = 350;

export function requestPairedExtensionUnlockIfEligible(
  request: PairedExtensionUnlockDeliveryRequest,
): PairedExtensionUnlockDeliveryState {
  const { shouldRequest, storeId, requester } = request;
  if (!shouldRequest || !storeId) {
    return { kind: PairedExtensionUnlockDeliveryKind.NotRequested };
  }
  return {
    kind: PairedExtensionUnlockDeliveryKind.Requested,
    delivery: requester.requestPairedExtensionUnlock(storeId),
  };
}

export async function pairedExtensionUnlockWasAccepted(
  delivery: PairedExtensionUnlockDeliveryState,
): Promise<boolean> {
  switch (delivery.kind) {
    case PairedExtensionUnlockDeliveryKind.NotRequested:
      return false;
    case PairedExtensionUnlockDeliveryKind.Requested:
      return delivery.delivery;
  }
}

export async function waitForPairedExtensionUnlock(
  request: PairedExtensionUnlockPollRequest,
): Promise<void> {
  const deadline = Date.now() + PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS;
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, PAIRED_EXTENSION_UNLOCK_RETRY_MS);
      });
    }
    const resumed = await request.resumePairedVault(request.storeId);
    if (resumed.isErr()) return;
    if (request.isAuthenticated()) return;
  }
}
