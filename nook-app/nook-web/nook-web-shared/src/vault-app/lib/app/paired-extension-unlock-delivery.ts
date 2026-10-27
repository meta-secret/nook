import type { Result } from "neverthrow";
import {
  is_vault_session_locked,
  VaultCompanionAutoResumeDecision,
  type NookVaultClientPolicy,
} from "$app-wasm";
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

/** One discovery of the paired extension and, when it is unlocked, the
 * handoff of its identity to this page. */
export type PairedExtensionResume = Promise<
  Result<PairedExtensionResumeStatus, PairedExtensionDiscoveryFailure>
>;

export type PairedExtensionUnlockPollRequest = {
  readonly storeId: string;
  readonly isAuthenticated: () => boolean;
  readonly resumePairedVault: (storeId: string) => PairedExtensionResume;
};

/** Resumes from the paired extension run one after another. The extension
 * keeps one handoff endpoint, which each discovery replaces: a discovery
 * made while an earlier resume still hands its identity over voids that
 * handoff, and the page shows the handoff as failed. The card's unlock and
 * the page's own resume both ask, so they wait their turn here. */
export class PairedExtensionResumeQueue {
  private tail: Promise<void> = Promise.resolve();

  run(resume: () => PairedExtensionResume): PairedExtensionResume {
    const turn = this.tail.then(resume);
    // The next resume waits for this one to end, however it ends; its
    // caller still receives the outcome.
    this.tail = turn.then(
      () => {},
      () => {},
    );
    return turn;
  }
}

/** A locked page waits for the person after an explicit lock in this
 * session (the Lock button, an idle lock): a paired extension that is still
 * unlocked never reopens the vault on its own. Their own unlock still uses it. */
export function pairedExtensionAutoResumeHeld(
  policy: NookVaultClientPolicy,
): boolean {
  return (
    policy.companion_auto_resume_decision(is_vault_session_locked()) ===
    VaultCompanionAutoResumeDecision.HoldForUser
  );
}

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

/** How long a page waits for the paired extension to unlock, and how often
 * it asks again meanwhile. */
export const PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS = 30_000;
export const PAIRED_EXTENSION_UNLOCK_RETRY_MS = 350;

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
