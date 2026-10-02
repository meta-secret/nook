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
  readonly resumePairedVault: (storeId: string) => Promise<unknown>;
};

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
    await request.resumePairedVault(request.storeId);
    if (request.isAuthenticated()) return;
  }
}
