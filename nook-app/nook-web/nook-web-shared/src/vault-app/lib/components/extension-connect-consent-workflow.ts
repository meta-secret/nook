import {
  NookExtensionConsentApprovalAvailabilityState,
  NookExtensionConsentEvent,
  NookExtensionConsentPhase,
  NookExtensionConsentPhaseState,
  NookExtensionConsentTransitionState,
  NookExtensionConsentVaultReadiness,
} from "$app-wasm";
import { err, type Result } from "neverthrow";
import type { I18nKey } from "../../../generated/i18n-keys";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { ExtensionConnectRequest } from "../extension/connect";
import {
  ExtensionPairingDeliveryKind,
  type ExtensionPairingDelivery,
  type ExtensionPairingRejectionReason,
} from "../extension/extension-pairing-delivery";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "../runtime/storage-failure";
import type { VaultState } from "../vault.svelte";
import { ExtensionVaultApproval } from "../extension/vault-approval";

export enum ExtensionConsentWorkflowKind {
  Resting = "resting",
  SubmittingAuthorization = "submitting-authorization",
  PreparingGrant = "preparing-grant",
  DeliveringGrant = "delivering-grant",
  RefreshingDevices = "refreshing-devices",
  Completed = "completed",
  Failed = "failed",
}

export enum ExtensionConsentWorkflowFailureKind {
  Authorization = "authorization",
  GrantPreparation = "grant-preparation",
  DeliveryAdmission = "delivery-admission",
  BrowserHandoff = "browser-handoff",
  DeviceRefresh = "device-refresh",
  CompletionAdmission = "completion-admission",
  ProviderTransition = "provider-transition",
}

export enum ExtensionConsentDeliveryOutcomeKind {
  Delivered = "delivered",
  MessagingUnavailable = "messaging-unavailable",
  PlaintextProviderMigrationRequired = "plaintext-provider-migration-required",
  Rejected = "rejected",
}

export enum ExtensionConsentRejectionKind {
  WithReason = "with-reason",
  WithoutReason = "without-reason",
}

export enum ExtensionConsentCloseOutcome {
  Cancelled = "cancelled",
  Approved = "approved",
}

export type ExtensionConsentRejection =
  | {
      readonly kind: ExtensionConsentRejectionKind.WithReason;
      readonly reason: ExtensionPairingRejectionReason;
    }
  | { readonly kind: ExtensionConsentRejectionKind.WithoutReason };

export type ExtensionConsentDeliveryOutcome =
  | { readonly kind: ExtensionConsentDeliveryOutcomeKind.Delivered }
  | {
      readonly kind: ExtensionConsentDeliveryOutcomeKind.MessagingUnavailable;
    }
  | {
      readonly kind: ExtensionConsentDeliveryOutcomeKind.PlaintextProviderMigrationRequired;
    }
  | {
      readonly kind: ExtensionConsentDeliveryOutcomeKind.Rejected;
      readonly rejection: ExtensionConsentRejection;
    };

export type ExtensionConsentWorkflowFailure =
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.Authorization;
      readonly failure: VaultStorageFailure;
    }
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.GrantPreparation;
      readonly failure: VaultStorageFailure;
    }
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.DeliveryAdmission;
      readonly failure: VaultStorageFailure;
    }
  | { readonly kind: ExtensionConsentWorkflowFailureKind.BrowserHandoff }
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.DeviceRefresh;
      readonly failure: VaultStorageFailure;
    }
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.CompletionAdmission;
      readonly failure: VaultStorageFailure;
    }
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.ProviderTransition;
      readonly state: NookExtensionConsentTransitionState;
    };

export type ExtensionConsentWorkflowState =
  | {
      readonly kind: ExtensionConsentWorkflowKind.Resting;
      readonly phase: NookExtensionConsentPhase;
    }
  | {
      readonly kind: ExtensionConsentWorkflowKind.SubmittingAuthorization;
      readonly phase: NookExtensionConsentPhase;
    }
  | {
      readonly kind: ExtensionConsentWorkflowKind.PreparingGrant;
      readonly phase: NookExtensionConsentPhase;
    }
  | {
      readonly kind: ExtensionConsentWorkflowKind.DeliveringGrant;
      readonly phase: NookExtensionConsentPhase;
    }
  | {
      readonly kind: ExtensionConsentWorkflowKind.RefreshingDevices;
      readonly phase: NookExtensionConsentPhase;
      readonly outcome: ExtensionConsentDeliveryOutcome;
    }
  | {
      readonly kind: ExtensionConsentWorkflowKind.Completed;
      readonly phase: NookExtensionConsentPhase;
      readonly outcome: ExtensionConsentDeliveryOutcome;
    }
  | {
      readonly kind: ExtensionConsentWorkflowKind.Failed;
      readonly phase: NookExtensionConsentPhase;
      readonly failure: ExtensionConsentWorkflowFailure;
    };

export enum ExtensionConsentWorkflowNoticeKind {
  Hidden = "hidden",
  Message = "message",
  Rejected = "rejected",
}

export type ExtensionConsentWorkflowNotice =
  | { readonly kind: ExtensionConsentWorkflowNoticeKind.Hidden }
  | {
      readonly kind: ExtensionConsentWorkflowNoticeKind.Message;
      readonly translationKey: I18nKey;
    }
  | {
      readonly kind: ExtensionConsentWorkflowNoticeKind.Rejected;
      readonly translationKey: I18nKey;
      readonly rejection: ExtensionConsentRejection;
    };

function deliveryOutcome(value: ExtensionPairingDelivery): ExtensionConsentDeliveryOutcome {
  switch (value.kind) {
    case ExtensionPairingDeliveryKind.Delivered:
      return { kind: ExtensionConsentDeliveryOutcomeKind.Delivered };
    case ExtensionPairingDeliveryKind.MessagingUnavailable:
      return { kind: ExtensionConsentDeliveryOutcomeKind.MessagingUnavailable };
    case ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired:
      return {
        kind: ExtensionConsentDeliveryOutcomeKind.PlaintextProviderMigrationRequired,
      };
    case ExtensionPairingDeliveryKind.Rejected:
      return "reason" in value
        ? {
            kind: ExtensionConsentDeliveryOutcomeKind.Rejected,
            rejection: {
              kind: ExtensionConsentRejectionKind.WithReason,
              reason: value.reason,
            },
          }
        : {
            kind: ExtensionConsentDeliveryOutcomeKind.Rejected,
            rejection: { kind: ExtensionConsentRejectionKind.WithoutReason },
          };
  }
}

/** Owns browser consent orchestration while Rust owns durable phase and readiness decisions. */
export class ExtensionConnectConsentWorkflow {
  constructor(
    private readonly vault: VaultState,
    private readonly request: ExtensionConnectRequest,
  ) {}

  initialState(): ExtensionConsentWorkflowState {
    return {
      kind: ExtensionConsentWorkflowKind.Resting,
      phase: NookExtensionConsentPhase.awaiting_authorization(),
    };
  }

  approvalAvailability(
    state: ExtensionConsentWorkflowState,
  ): NookExtensionConsentApprovalAvailabilityState {
    const availability = state.phase.approval_availability(
      this.vaultReadiness(),
    );
    try {
      return availability.state;
    } finally {
      availability.free();
    }
  }

  canAuthorize(state: ExtensionConsentWorkflowState): boolean {
    const availability = state.phase.approval_availability(
      this.vaultReadiness(),
    );
    try {
      return availability.can_approve();
    } finally {
      availability.free();
    }
  }

  closeOutcome(
    state: ExtensionConsentWorkflowState,
  ): ExtensionConsentCloseOutcome {
    return state.phase.state === NookExtensionConsentPhaseState.Approved
      ? ExtensionConsentCloseOutcome.Approved
      : ExtensionConsentCloseOutcome.Cancelled;
  }

  dispose(state: ExtensionConsentWorkflowState): void {
    state.phase.free();
  }

  async approve(
    state: ExtensionConsentWorkflowState,
    publish: (state: ExtensionConsentWorkflowState) => void,
  ): Promise<void> {
    let startingState: Extract<
      ExtensionConsentWorkflowState,
      { kind: ExtensionConsentWorkflowKind.Resting }
    >;
    if (state.kind === ExtensionConsentWorkflowKind.Resting) {
      startingState = state;
    } else if (
      state.kind === ExtensionConsentWorkflowKind.Failed &&
      state.phase.state ===
        NookExtensionConsentPhaseState.AuthorizationFailed
    ) {
      startingState = {
        kind: ExtensionConsentWorkflowKind.Resting,
        phase: state.phase,
      };
    } else {
      return;
    }
    if (!this.canAuthorize(startingState)) return;

    const started = startingState.phase.transition(
      NookExtensionConsentEvent.AuthorizationStarted,
    );
    if (started.state === NookExtensionConsentTransitionState.Rejected) {
      started.free();
      publish({
        kind: ExtensionConsentWorkflowKind.Failed,
        phase: startingState.phase,
        failure: {
          kind: ExtensionConsentWorkflowFailureKind.ProviderTransition,
          state: NookExtensionConsentTransitionState.Rejected,
        },
      });
      return;
    }
    const authorizingPhase = started.phase();
    started.free();
    startingState.phase.free();

    this.vault.dismissError();
    this.vault.isSaving = true;
    try {
      publish({
        kind: ExtensionConsentWorkflowKind.SubmittingAuthorization,
        phase: authorizingPhase,
      });
      const approval = new ExtensionVaultApproval(this.vault, this.request);
      let authorization: Result<void, VaultStorageFailure>;
      try {
        authorization = await approval.authorize();
      } catch (failure) {
        authorization = err(new NativeVaultStorageFailure(failure));
      }
      if (authorization.isErr()) {
        const failed = authorizingPhase.transition(
          NookExtensionConsentEvent.AuthorizationFailed,
        );
        if (failed.state === NookExtensionConsentTransitionState.Transitioned) {
          const failedPhase = failed.phase();
          failed.free();
          authorizingPhase.free();
          publish({
            kind: ExtensionConsentWorkflowKind.Failed,
            phase: failedPhase,
            failure: {
              kind: ExtensionConsentWorkflowFailureKind.Authorization,
              failure: authorization.error,
            },
          });
        } else {
          failed.free();
          publish({
            kind: ExtensionConsentWorkflowKind.Failed,
            phase: authorizingPhase,
            failure: {
              kind: ExtensionConsentWorkflowFailureKind.ProviderTransition,
              state: NookExtensionConsentTransitionState.Rejected,
            },
          });
        }
        return;
      }

      const authorizationSucceeded = authorizingPhase.transition(
        NookExtensionConsentEvent.AuthorizationSucceeded,
      );
      if (
        authorizationSucceeded.state ===
        NookExtensionConsentTransitionState.Rejected
      ) {
        authorizationSucceeded.free();
        publish({
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: authorizingPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.ProviderTransition,
            state: NookExtensionConsentTransitionState.Rejected,
          },
        });
        return;
      }
      const approvedPhase = authorizationSucceeded.phase();
      authorizationSucceeded.free();
      authorizingPhase.free();

      publish({
        kind: ExtensionConsentWorkflowKind.PreparingGrant,
        phase: approvedPhase,
      });
      let prepared: Awaited<ReturnType<typeof approval.prepareAuthorizedGrant>>;
      try {
        prepared = await approval.prepareAuthorizedGrant();
      } catch (failure) {
        publish({
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.GrantPreparation,
            failure: new NativeVaultStorageFailure(failure),
          },
        });
        return;
      }
      if (prepared.isErr()) {
        publish({
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.GrantPreparation,
            failure: prepared.error,
          },
        });
        return;
      }

      publish({
        kind: ExtensionConsentWorkflowKind.DeliveringGrant,
        phase: approvedPhase,
      });
      let delivered: Awaited<ReturnType<typeof approval.deliver>>;
      try {
        delivered = await approval.deliver(prepared.value);
      } catch {
        publish({
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: { kind: ExtensionConsentWorkflowFailureKind.BrowserHandoff },
        });
        return;
      }
      if (delivered.isErr()) {
        publish({
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.DeliveryAdmission,
            failure: delivered.error,
          },
        });
        return;
      }

      const outcome = deliveryOutcome(delivered.value);
      publish({
        kind: ExtensionConsentWorkflowKind.RefreshingDevices,
        phase: approvedPhase,
        outcome,
      });
      let devices: Awaited<ReturnType<VaultState["refreshDeviceState"]>>;
      try {
        devices = await this.vault.refreshDeviceState();
      } catch (failure) {
        publish({
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.DeviceRefresh,
            failure: new NativeVaultStorageFailure(failure),
          },
        });
        return;
      }
      if (devices.isErr()) {
        publish({
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.DeviceRefresh,
            failure: devices.error,
          },
        });
        return;
      }

      const completion = approval.admitCompletion();
      if (completion.isErr()) {
        publish({
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.CompletionAdmission,
            failure: completion.error,
          },
        });
        return;
      }

      publish({
        kind: ExtensionConsentWorkflowKind.Completed,
        phase: approvedPhase,
        outcome,
      });
    } finally {
      this.vault.isSaving = false;
    }
  }

  private vaultReadiness(): NookExtensionConsentVaultReadiness {
    if (!this.vault.hasManager)
      return NookExtensionConsentVaultReadiness.ManagerUnavailable;
    if (!this.vault.isAuthenticated)
      return NookExtensionConsentVaultReadiness.Locked;
    if (this.vault.isVerifying)
      return NookExtensionConsentVaultReadiness.Verifying;
    if (this.vault.isSaving)
      return NookExtensionConsentVaultReadiness.Saving;
    return NookExtensionConsentVaultReadiness.Ready;
  }
}

export class ExtensionConsentWorkflowPresentation {
  notice(
    state: ExtensionConsentWorkflowState,
    availability: NookExtensionConsentApprovalAvailabilityState,
  ): ExtensionConsentWorkflowNotice {
    switch (state.kind) {
      case ExtensionConsentWorkflowKind.Resting:
        switch (availability) {
          case NookExtensionConsentApprovalAvailabilityState.ManagerUnavailable:
            return {
              kind: ExtensionConsentWorkflowNoticeKind.Message,
              translationKey: I18N_KEYS.ErrorsEngineUnavailable,
            };
          case NookExtensionConsentApprovalAvailabilityState.VaultLocked:
            return {
              kind: ExtensionConsentWorkflowNoticeKind.Message,
              translationKey: I18N_KEYS.ExtensionConsentUnlockFirst,
            };
          case NookExtensionConsentApprovalAvailabilityState.VaultBusy:
          case NookExtensionConsentApprovalAvailabilityState.Available:
          case NookExtensionConsentApprovalAvailabilityState.AuthorizationInProgress:
          case NookExtensionConsentApprovalAvailabilityState.AlreadyApproved:
          case NookExtensionConsentApprovalAvailabilityState.RetryAvailable:
            return { kind: ExtensionConsentWorkflowNoticeKind.Hidden };
        }
      case ExtensionConsentWorkflowKind.SubmittingAuthorization:
      case ExtensionConsentWorkflowKind.PreparingGrant:
      case ExtensionConsentWorkflowKind.DeliveringGrant:
      case ExtensionConsentWorkflowKind.RefreshingDevices:
        return { kind: ExtensionConsentWorkflowNoticeKind.Hidden };
      case ExtensionConsentWorkflowKind.Failed:
        return {
          kind: ExtensionConsentWorkflowNoticeKind.Message,
          translationKey: this.failureTranslationKey(state.failure),
        };
      case ExtensionConsentWorkflowKind.Completed:
        return this.outcomeNotice(state.outcome);
    }
  }

  failureTranslationKey(failure: ExtensionConsentWorkflowFailure): I18nKey {
    switch (failure.kind) {
      case ExtensionConsentWorkflowFailureKind.Authorization:
      case ExtensionConsentWorkflowFailureKind.GrantPreparation:
      case ExtensionConsentWorkflowFailureKind.DeliveryAdmission:
      case ExtensionConsentWorkflowFailureKind.DeviceRefresh:
      case ExtensionConsentWorkflowFailureKind.CompletionAdmission:
        return failure.failure.translationKey;
      case ExtensionConsentWorkflowFailureKind.BrowserHandoff:
        return I18N_KEYS.ExtensionConnectIdentityHandoffFailed;
      case ExtensionConsentWorkflowFailureKind.ProviderTransition:
        return I18N_KEYS.ExtensionConsentApprovalFailed;
    }
  }

  private outcomeNotice(
    outcome: ExtensionConsentDeliveryOutcome,
  ): ExtensionConsentWorkflowNotice {
    switch (outcome.kind) {
      case ExtensionConsentDeliveryOutcomeKind.Delivered:
        return {
          kind: ExtensionConsentWorkflowNoticeKind.Message,
          translationKey: I18N_KEYS.ExtensionConsentApprovedReturn,
        };
      case ExtensionConsentDeliveryOutcomeKind.MessagingUnavailable:
        return {
          kind: ExtensionConsentWorkflowNoticeKind.Message,
          translationKey: I18N_KEYS.ExtensionConsentMessagingUnavailable,
        };
      case ExtensionConsentDeliveryOutcomeKind.PlaintextProviderMigrationRequired:
        return {
          kind: ExtensionConsentWorkflowNoticeKind.Message,
          translationKey:
            I18N_KEYS.ExtensionConsentPlaintextProviderMigrationRequired,
        };
      case ExtensionConsentDeliveryOutcomeKind.Rejected:
        return {
          kind: ExtensionConsentWorkflowNoticeKind.Rejected,
          translationKey: I18N_KEYS.ExtensionConsentGrantRejected,
          rejection: outcome.rejection,
        };
    }
  }
}
