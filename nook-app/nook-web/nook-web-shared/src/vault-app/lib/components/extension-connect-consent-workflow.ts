import {
  NookExtensionConsentApprovalAvailabilityState,
  NookExtensionConsentEvent,
  NookExtensionConsentPhase,
  NookExtensionConsentPhaseState,
  NookExtensionConsentTransitionState,
  NookExtensionConsentVaultReadiness,
  type NookExtensionDeviceApproval,
} from "$app-wasm";
import { err, type Result } from "neverthrow";
import type { I18nKey } from "../../../generated/i18n-keys";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { OAuthFailure } from "../auth/oauth-failure";
import type { ExtensionConnectRequest } from "../extension/connect";
import {
  ExtensionPairingDeliveryKind,
  type ExtensionPairingDelivery,
  type ExtensionPairingRejectionReason,
} from "../extension/extension-pairing-delivery";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "../runtime/storage-failure";
import type { VaultState } from "../vault.svelte";
import { ExtensionVaultApproval } from "../extension/vault-approval";
import { ExtensionConsentCloseOutcome } from "./extension-connect-consent-outcome";

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
  NonDeliveryOutcome = "non-delivery-outcome",
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

export type ExtensionConsentRejection =
  | {
      readonly kind: ExtensionConsentRejectionKind.WithReason;
      readonly reason: ExtensionPairingRejectionReason;
    }
  | { readonly kind: ExtensionConsentRejectionKind.WithoutReason };

export type ExtensionConsentDeliveryOutcome =
  | {
      readonly kind: ExtensionConsentDeliveryOutcomeKind.Delivered;
      readonly eventCount: number;
    }
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
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.NonDeliveryOutcome;
      readonly outcome: ExtensionConsentDeliveryOutcome;
    }
  | { readonly kind: ExtensionConsentWorkflowFailureKind.BrowserHandoff }
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.DeviceRefresh;
      readonly failure: ExtensionConsentDeviceRefreshFailure;
    }
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.CompletionAdmission;
      readonly failure: VaultStorageFailure;
    }
  | {
      readonly kind: ExtensionConsentWorkflowFailureKind.ProviderTransition;
      readonly state: NookExtensionConsentTransitionState;
    };

type ExtensionConsentDeviceRefreshFailure = VaultStorageFailure | OAuthFailure;

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

type ExtensionConsentVisibleNotice =
  | {
      readonly kind: ExtensionConsentWorkflowNoticeKind.Message;
      readonly translationKey: I18nKey;
    }
  | {
      readonly kind: ExtensionConsentWorkflowNoticeKind.Rejected;
      readonly translationKey: I18nKey;
      readonly rejection: ExtensionConsentRejection;
    };

export type ExtensionConsentWorkflowNotice =
  | { readonly kind: ExtensionConsentWorkflowNoticeKind.Hidden }
  | ExtensionConsentVisibleNotice;

enum ExtensionConsentWorkflowLifecycleKind {
  NotStarted = "not-started",
  Ready = "ready",
  Approving = "approving",
  DisposedDuringApproval = "disposed-during-approval",
  Disposed = "disposed",
}

type ExtensionConsentWorkflowLifecycle =
  | { readonly kind: ExtensionConsentWorkflowLifecycleKind.NotStarted }
  | {
      readonly kind: ExtensionConsentWorkflowLifecycleKind.Ready;
      readonly phase: NookExtensionConsentPhase;
    }
  | {
      readonly kind: ExtensionConsentWorkflowLifecycleKind.Approving;
      readonly phase: NookExtensionConsentPhase;
    }
  | {
      readonly kind: ExtensionConsentWorkflowLifecycleKind.DisposedDuringApproval;
      readonly phase: NookExtensionConsentPhase;
    }
  | { readonly kind: ExtensionConsentWorkflowLifecycleKind.Disposed };

enum ExtensionConsentAuthorizationOwnerKind {
  Empty = "empty",
  Authorized = "authorized",
}

type ExtensionConsentAuthorizationOwner =
  | { readonly kind: ExtensionConsentAuthorizationOwnerKind.Empty }
  | {
      readonly kind: ExtensionConsentAuthorizationOwnerKind.Authorized;
      readonly approval: ExtensionVaultApproval;
    };

type ExtensionConnectConsentWorkflowRequest = {
  readonly vault: VaultState;
  readonly request: ExtensionConnectRequest;
};

export type ExtensionConsentApprovalRequest = {
  readonly state: ExtensionConsentWorkflowState;
  readonly publish: (state: ExtensionConsentWorkflowState) => void;
};

type ExtensionConsentGrantDeliveryRequest = {
  readonly approval: ExtensionVaultApproval;
  readonly approvedPhase: NookExtensionConsentPhase;
  readonly publish: (state: ExtensionConsentWorkflowState) => void;
};

type ExtensionConsentPhaseReplacement = {
  readonly previousPhase: NookExtensionConsentPhase;
  readonly nextPhase: NookExtensionConsentPhase;
};

type ExtensionConsentStatePublication = {
  readonly state: ExtensionConsentWorkflowState;
  readonly publish: (state: ExtensionConsentWorkflowState) => void;
};

export type ExtensionConsentNoticeRequest = {
  readonly state: ExtensionConsentWorkflowState;
  readonly availability: NookExtensionConsentApprovalAvailabilityState;
};

function deliveryOutcome(
  value: ExtensionPairingDelivery,
): ExtensionConsentDeliveryOutcome {
  switch (value.kind) {
    case ExtensionPairingDeliveryKind.Delivered:
      return {
        kind: ExtensionConsentDeliveryOutcomeKind.Delivered,
        eventCount: value.eventCount,
      };
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
  private lifecycle: ExtensionConsentWorkflowLifecycle = {
    kind: ExtensionConsentWorkflowLifecycleKind.NotStarted,
  };
  private authorizationOwner: ExtensionConsentAuthorizationOwner = {
    kind: ExtensionConsentAuthorizationOwnerKind.Empty,
  };

  private readonly vault: VaultState;
  private readonly request: ExtensionConnectRequest;

  constructor(request: ExtensionConnectConsentWorkflowRequest) {
    this.vault = request.vault;
    this.request = request.request;
  }

  initialState(): ExtensionConsentWorkflowState {
    if (
      this.lifecycle.kind !== ExtensionConsentWorkflowLifecycleKind.NotStarted
    ) {
      throw new Error(
        "Extension consent workflow has already been initialized.",
      );
    }
    const phase = NookExtensionConsentPhase.awaiting_authorization();
    this.lifecycle = {
      kind: ExtensionConsentWorkflowLifecycleKind.Ready,
      phase,
    };
    return {
      kind: ExtensionConsentWorkflowKind.Resting,
      phase,
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
    if (!this.isReadyOwner(state.phase)) return false;
    const availability = state.phase.approval_availability(
      this.vaultReadiness(),
    );
    try {
      return availability.can_approve();
    } finally {
      availability.free();
    }
  }

  canContinue(state: ExtensionConsentWorkflowState): boolean {
    if (!this.isReadyOwner(state.phase)) return false;
    if (
      state.kind === ExtensionConsentWorkflowKind.Failed &&
      state.phase.state === NookExtensionConsentPhaseState.Approved
    ) {
      return this.vaultReadiness() === NookExtensionConsentVaultReadiness.Ready;
    }
    return this.canAuthorize(state);
  }

  closeOutcome(
    state: ExtensionConsentWorkflowState,
  ): ExtensionConsentCloseOutcome {
    return state.phase.state === NookExtensionConsentPhaseState.Approved
      ? ExtensionConsentCloseOutcome.Approved
      : ExtensionConsentCloseOutcome.Cancelled;
  }

  dispose(): void {
    switch (this.lifecycle.kind) {
      case ExtensionConsentWorkflowLifecycleKind.NotStarted:
        this.lifecycle = {
          kind: ExtensionConsentWorkflowLifecycleKind.Disposed,
        };
        return;
      case ExtensionConsentWorkflowLifecycleKind.Ready:
        this.releaseAuthorization();
        this.lifecycle.phase.free();
        this.lifecycle = {
          kind: ExtensionConsentWorkflowLifecycleKind.Disposed,
        };
        return;
      case ExtensionConsentWorkflowLifecycleKind.Approving:
        this.lifecycle = {
          kind: ExtensionConsentWorkflowLifecycleKind.DisposedDuringApproval,
          phase: this.lifecycle.phase,
        };
        return;
      case ExtensionConsentWorkflowLifecycleKind.DisposedDuringApproval:
      case ExtensionConsentWorkflowLifecycleKind.Disposed:
        return;
    }
  }

  async approve({
    state,
    publish,
  }: ExtensionConsentApprovalRequest): Promise<void> {
    const retriesAuthorization =
      state.kind === ExtensionConsentWorkflowKind.Failed &&
      state.phase.state === NookExtensionConsentPhaseState.AuthorizationFailed;
    const resumesDelivery =
      state.kind === ExtensionConsentWorkflowKind.Failed &&
      state.phase.state === NookExtensionConsentPhaseState.Approved;
    if (
      state.kind !== ExtensionConsentWorkflowKind.Resting &&
      !retriesAuthorization &&
      !resumesDelivery
    ) {
      return;
    }
    if (!this.canContinue(state)) return;

    this.lifecycle = {
      kind: ExtensionConsentWorkflowLifecycleKind.Approving,
      phase: state.phase,
    };
    this.vault.dismissError();
    this.vault.isSaving = true;
    try {
      if (resumesDelivery) {
        switch (this.authorizationOwner.kind) {
          case ExtensionConsentAuthorizationOwnerKind.Empty:
            {
              const publication: ExtensionConsentStatePublication = {
                publish,
                state: {
                  kind: ExtensionConsentWorkflowKind.Failed,
                  phase: state.phase,
                  failure: {
                    kind: ExtensionConsentWorkflowFailureKind.GrantPreparation,
                    failure: new VaultStorageFailure(
                      VaultStorageFailureKind.ExtensionApprovalContextChanged,
                    ),
                  },
                },
              };
              this.publish(publication);
            }
            return;
          case ExtensionConsentAuthorizationOwnerKind.Authorized: {
            const deliveryRequest: ExtensionConsentGrantDeliveryRequest = {
              approval: this.authorizationOwner.approval,
              approvedPhase: state.phase,
              publish,
            };
            await this.deliverApprovedGrant(deliveryRequest);
            return;
          }
        }
      }

      const approval = new ExtensionVaultApproval(this.vault, this.request);
      {
        const started = state.phase.transition(
          NookExtensionConsentEvent.AuthorizationStarted,
        );
        if (started.state === NookExtensionConsentTransitionState.Rejected) {
          started.free();
          const publication: ExtensionConsentStatePublication = {
            publish,
            state: {
              kind: ExtensionConsentWorkflowKind.Failed,
              phase: state.phase,
              failure: {
                kind: ExtensionConsentWorkflowFailureKind.ProviderTransition,
                state: NookExtensionConsentTransitionState.Rejected,
              },
            },
          };
          this.publish(publication);
          return;
        }
        const authorizingPhase = started.phase();
        started.free();
        const authorizationPhaseReplacement: ExtensionConsentPhaseReplacement =
          {
            previousPhase: state.phase,
            nextPhase: authorizingPhase,
          };
        this.replacePhase(authorizationPhaseReplacement);
        const authorizationPublication: ExtensionConsentStatePublication = {
          publish,
          state: {
            kind: ExtensionConsentWorkflowKind.SubmittingAuthorization,
            phase: authorizingPhase,
          },
        };
        if (!this.publish(authorizationPublication)) {
          return;
        }

        let authorization: Result<
          NookExtensionDeviceApproval,
          VaultStorageFailure
        >;
        try {
          authorization = await approval.authorize();
        } catch (failure) {
          authorization = err(new NativeVaultStorageFailure(failure));
        }
        if (!this.isApproving()) {
          if (authorization.isOk()) approval.releaseAuthorization();
          return;
        }
        if (authorization.isErr()) {
          const failed = authorizingPhase.transition(
            NookExtensionConsentEvent.AuthorizationFailed,
          );
          if (
            failed.state === NookExtensionConsentTransitionState.Transitioned
          ) {
            const failedPhase = failed.phase();
            failed.free();
            const failurePhaseReplacement: ExtensionConsentPhaseReplacement = {
              previousPhase: authorizingPhase,
              nextPhase: failedPhase,
            };
            this.replacePhase(failurePhaseReplacement);
            const publication: ExtensionConsentStatePublication = {
              publish,
              state: {
                kind: ExtensionConsentWorkflowKind.Failed,
                phase: failedPhase,
                failure: {
                  kind: ExtensionConsentWorkflowFailureKind.Authorization,
                  failure: authorization.error,
                },
              },
            };
            this.publish(publication);
          } else {
            failed.free();
            const publication: ExtensionConsentStatePublication = {
              publish,
              state: {
                kind: ExtensionConsentWorkflowKind.Failed,
                phase: authorizingPhase,
                failure: {
                  kind: ExtensionConsentWorkflowFailureKind.ProviderTransition,
                  state: NookExtensionConsentTransitionState.Rejected,
                },
              },
            };
            this.publish(publication);
          }
          return;
        }

        this.authorizationOwner = {
          kind: ExtensionConsentAuthorizationOwnerKind.Authorized,
          approval,
        };

        const authorizationSucceeded = authorizingPhase.transition(
          NookExtensionConsentEvent.AuthorizationSucceeded,
        );
        if (
          authorizationSucceeded.state ===
          NookExtensionConsentTransitionState.Rejected
        ) {
          authorizationSucceeded.free();
          const publication: ExtensionConsentStatePublication = {
            publish,
            state: {
              kind: ExtensionConsentWorkflowKind.Failed,
              phase: authorizingPhase,
              failure: {
                kind: ExtensionConsentWorkflowFailureKind.ProviderTransition,
                state: NookExtensionConsentTransitionState.Rejected,
              },
            },
          };
          this.publish(publication);
          return;
        }
        const approvedPhase = authorizationSucceeded.phase();
        authorizationSucceeded.free();
        const approvalPhaseReplacement: ExtensionConsentPhaseReplacement = {
          previousPhase: authorizingPhase,
          nextPhase: approvedPhase,
        };
        this.replacePhase(approvalPhaseReplacement);
        const deliveryRequest: ExtensionConsentGrantDeliveryRequest = {
          approval,
          approvedPhase,
          publish,
        };
        await this.deliverApprovedGrant(deliveryRequest);
        return;
      }
    } finally {
      this.finishApproval();
      this.vault.isSaving = false;
    }
  }

  private async deliverApprovedGrant({
    approval,
    approvedPhase,
    publish,
  }: ExtensionConsentGrantDeliveryRequest): Promise<void> {
    const preparingPublication: ExtensionConsentStatePublication = {
      publish,
      state: {
        kind: ExtensionConsentWorkflowKind.PreparingGrant,
        phase: approvedPhase,
      },
    };
    if (!this.publish(preparingPublication)) {
      return;
    }
    let prepared: Awaited<ReturnType<typeof approval.prepareAuthorizedGrant>>;
    try {
      prepared = await approval.prepareAuthorizedGrant();
    } catch (failure) {
      if (!this.isApproving()) return;
      const publication: ExtensionConsentStatePublication = {
        publish,
        state: {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.GrantPreparation,
            failure: new NativeVaultStorageFailure(failure),
          },
        },
      };
      this.publish(publication);
      return;
    }
    if (!this.isApproving()) return;
    if (prepared.isErr()) {
      const publication: ExtensionConsentStatePublication = {
        publish,
        state: {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.GrantPreparation,
            failure: prepared.error,
          },
        },
      };
      this.publish(publication);
      return;
    }

    const deliveryPublication: ExtensionConsentStatePublication = {
      publish,
      state: {
        kind: ExtensionConsentWorkflowKind.DeliveringGrant,
        phase: approvedPhase,
      },
    };
    if (!this.publish(deliveryPublication)) {
      return;
    }
    let delivered: Awaited<ReturnType<typeof approval.deliver>>;
    try {
      delivered = await approval.deliver(prepared.value);
    } catch {
      if (!this.isApproving()) return;
      const publication: ExtensionConsentStatePublication = {
        publish,
        state: {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: { kind: ExtensionConsentWorkflowFailureKind.BrowserHandoff },
        },
      };
      this.publish(publication);
      return;
    }
    if (!this.isApproving()) return;
    if (delivered.isErr()) {
      const publication: ExtensionConsentStatePublication = {
        publish,
        state: {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.DeliveryAdmission,
            failure: delivered.error,
          },
        },
      };
      this.publish(publication);
      return;
    }

    const outcome = deliveryOutcome(delivered.value);
    if (outcome.kind !== ExtensionConsentDeliveryOutcomeKind.Delivered) {
      const publication: ExtensionConsentStatePublication = {
        publish,
        state: {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.NonDeliveryOutcome,
            outcome,
          },
        },
      };
      this.publish(publication);
      return;
    }

    const refreshPublication: ExtensionConsentStatePublication = {
      publish,
      state: {
        kind: ExtensionConsentWorkflowKind.RefreshingDevices,
        phase: approvedPhase,
        outcome,
      },
    };
    if (!this.publish(refreshPublication)) {
      return;
    }
    let devices: Awaited<ReturnType<VaultState["refreshDeviceState"]>>;
    try {
      devices = await this.vault.refreshDeviceState();
    } catch (failure) {
      if (!this.isApproving()) return;
      const publication: ExtensionConsentStatePublication = {
        publish,
        state: {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.DeviceRefresh,
            failure: new NativeVaultStorageFailure(failure),
          },
        },
      };
      this.publish(publication);
      return;
    }
    if (!this.isApproving()) return;
    if (devices.isErr()) {
      const publication: ExtensionConsentStatePublication = {
        publish,
        state: {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.DeviceRefresh,
            failure: devices.error,
          },
        },
      };
      this.publish(publication);
      return;
    }

    const completion = approval.admitCompletion();
    if (completion.isErr()) {
      const publication: ExtensionConsentStatePublication = {
        publish,
        state: {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.CompletionAdmission,
            failure: completion.error,
          },
        },
      };
      this.publish(publication);
      return;
    }

    const completionPublication: ExtensionConsentStatePublication = {
      publish,
      state: {
        kind: ExtensionConsentWorkflowKind.Completed,
        phase: approvedPhase,
        outcome,
      },
    };
    this.publish(completionPublication);
    this.releaseAuthorization();
  }

  private isReadyOwner(phase: NookExtensionConsentPhase): boolean {
    return (
      this.lifecycle.kind === ExtensionConsentWorkflowLifecycleKind.Ready &&
      this.lifecycle.phase === phase
    );
  }

  private isApproving(): boolean {
    return (
      this.lifecycle.kind === ExtensionConsentWorkflowLifecycleKind.Approving
    );
  }

  private replacePhase({
    previousPhase,
    nextPhase,
  }: ExtensionConsentPhaseReplacement): void {
    if (
      this.lifecycle.kind !== ExtensionConsentWorkflowLifecycleKind.Approving ||
      this.lifecycle.phase !== previousPhase
    ) {
      nextPhase.free();
      return;
    }
    this.lifecycle = {
      kind: ExtensionConsentWorkflowLifecycleKind.Approving,
      phase: nextPhase,
    };
    previousPhase.free();
  }

  private publish({
    state,
    publish,
  }: ExtensionConsentStatePublication): boolean {
    if (!this.isApproving()) return false;
    publish(state);
    return this.isApproving();
  }

  private finishApproval(): void {
    switch (this.lifecycle.kind) {
      case ExtensionConsentWorkflowLifecycleKind.Approving:
        this.lifecycle = {
          kind: ExtensionConsentWorkflowLifecycleKind.Ready,
          phase: this.lifecycle.phase,
        };
        return;
      case ExtensionConsentWorkflowLifecycleKind.DisposedDuringApproval:
        this.releaseAuthorization();
        this.lifecycle.phase.free();
        this.lifecycle = {
          kind: ExtensionConsentWorkflowLifecycleKind.Disposed,
        };
        return;
      case ExtensionConsentWorkflowLifecycleKind.NotStarted:
      case ExtensionConsentWorkflowLifecycleKind.Ready:
      case ExtensionConsentWorkflowLifecycleKind.Disposed:
        return;
    }
  }

  private releaseAuthorization(): void {
    switch (this.authorizationOwner.kind) {
      case ExtensionConsentAuthorizationOwnerKind.Empty:
        return;
      case ExtensionConsentAuthorizationOwnerKind.Authorized:
        this.authorizationOwner.approval.releaseAuthorization();
        this.authorizationOwner = {
          kind: ExtensionConsentAuthorizationOwnerKind.Empty,
        };
        return;
    }
  }

  private vaultReadiness(): NookExtensionConsentVaultReadiness {
    if (!this.vault.hasManager)
      return NookExtensionConsentVaultReadiness.ManagerUnavailable;
    if (!this.vault.isAuthenticated)
      return NookExtensionConsentVaultReadiness.Locked;
    if (this.vault.isVerifying)
      return NookExtensionConsentVaultReadiness.Verifying;
    if (this.vault.isSaving) return NookExtensionConsentVaultReadiness.Saving;
    return NookExtensionConsentVaultReadiness.Ready;
  }
}

export class ExtensionConsentWorkflowPresentation {
  actionTranslationKey(state: ExtensionConsentWorkflowState): I18nKey {
    if (
      state.kind === ExtensionConsentWorkflowKind.Failed &&
      (state.phase.state ===
        NookExtensionConsentPhaseState.AuthorizationFailed ||
        state.phase.state === NookExtensionConsentPhaseState.Approved)
    ) {
      return I18N_KEYS.DevicesAccessTryAgain;
    }
    return I18N_KEYS.ExtensionConsentApprove;
  }

  notice({
    state,
    availability,
  }: ExtensionConsentNoticeRequest): ExtensionConsentWorkflowNotice {
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
        break;
      case ExtensionConsentWorkflowKind.SubmittingAuthorization:
      case ExtensionConsentWorkflowKind.PreparingGrant:
      case ExtensionConsentWorkflowKind.DeliveringGrant:
      case ExtensionConsentWorkflowKind.RefreshingDevices:
        return { kind: ExtensionConsentWorkflowNoticeKind.Hidden };
      case ExtensionConsentWorkflowKind.Failed:
        if (
          state.failure.kind ===
          ExtensionConsentWorkflowFailureKind.NonDeliveryOutcome
        ) {
          return this.outcomeNotice(state.failure.outcome);
        }
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
      case ExtensionConsentWorkflowFailureKind.NonDeliveryOutcome:
        return this.outcomeNotice(failure.outcome).translationKey;
      case ExtensionConsentWorkflowFailureKind.BrowserHandoff:
        return I18N_KEYS.ExtensionConnectIdentityHandoffFailed;
      case ExtensionConsentWorkflowFailureKind.ProviderTransition:
        return I18N_KEYS.ExtensionConsentApprovalFailed;
    }
  }

  private outcomeNotice(
    outcome: ExtensionConsentDeliveryOutcome,
  ): ExtensionConsentVisibleNotice {
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
