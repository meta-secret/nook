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
  private lifecycle: ExtensionConsentWorkflowLifecycle = {
    kind: ExtensionConsentWorkflowLifecycleKind.NotStarted,
  };

  constructor(
    private readonly vault: VaultState,
    private readonly request: ExtensionConnectRequest,
  ) {}

  initialState(): ExtensionConsentWorkflowState {
    if (
      this.lifecycle.kind !== ExtensionConsentWorkflowLifecycleKind.NotStarted
    ) {
      throw new Error("Extension consent workflow has already been initialized.");
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
      return (
        this.vaultReadiness() === NookExtensionConsentVaultReadiness.Ready
      );
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
        this.lifecycle = { kind: ExtensionConsentWorkflowLifecycleKind.Disposed };
        return;
      case ExtensionConsentWorkflowLifecycleKind.Ready:
        this.lifecycle.phase.free();
        this.lifecycle = { kind: ExtensionConsentWorkflowLifecycleKind.Disposed };
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

  async approve(
    state: ExtensionConsentWorkflowState,
    publish: (state: ExtensionConsentWorkflowState) => void,
  ): Promise<void> {
    const retriesAuthorization =
      state.kind === ExtensionConsentWorkflowKind.Failed &&
      state.phase.state ===
        NookExtensionConsentPhaseState.AuthorizationFailed;
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
      const approval = new ExtensionVaultApproval(this.vault, this.request);
      if (!resumesDelivery) {
        const started = state.phase.transition(
          NookExtensionConsentEvent.AuthorizationStarted,
        );
        if (started.state === NookExtensionConsentTransitionState.Rejected) {
          started.free();
          this.publish(
            {
              kind: ExtensionConsentWorkflowKind.Failed,
              phase: state.phase,
              failure: {
                kind: ExtensionConsentWorkflowFailureKind.ProviderTransition,
                state: NookExtensionConsentTransitionState.Rejected,
              },
            },
            publish,
          );
          return;
        }
        const authorizingPhase = started.phase();
        started.free();
        this.replacePhase(state.phase, authorizingPhase);
        if (
          !this.publish(
            {
              kind: ExtensionConsentWorkflowKind.SubmittingAuthorization,
              phase: authorizingPhase,
            },
            publish,
          )
        ) {
          return;
        }

        let authorization: Result<void, VaultStorageFailure>;
        try {
          authorization = await approval.authorize();
        } catch (failure) {
          authorization = err(new NativeVaultStorageFailure(failure));
        }
        if (!this.isApproving()) return;
        if (authorization.isErr()) {
          const failed = authorizingPhase.transition(
            NookExtensionConsentEvent.AuthorizationFailed,
          );
          if (failed.state === NookExtensionConsentTransitionState.Transitioned) {
            const failedPhase = failed.phase();
            failed.free();
            this.replacePhase(authorizingPhase, failedPhase);
            this.publish(
              {
                kind: ExtensionConsentWorkflowKind.Failed,
                phase: failedPhase,
                failure: {
                  kind: ExtensionConsentWorkflowFailureKind.Authorization,
                  failure: authorization.error,
                },
              },
              publish,
            );
          } else {
            failed.free();
            this.publish(
              {
                kind: ExtensionConsentWorkflowKind.Failed,
                phase: authorizingPhase,
                failure: {
                  kind: ExtensionConsentWorkflowFailureKind.ProviderTransition,
                  state: NookExtensionConsentTransitionState.Rejected,
                },
              },
              publish,
            );
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
          this.publish(
            {
              kind: ExtensionConsentWorkflowKind.Failed,
              phase: authorizingPhase,
              failure: {
                kind: ExtensionConsentWorkflowFailureKind.ProviderTransition,
                state: NookExtensionConsentTransitionState.Rejected,
              },
            },
            publish,
          );
          return;
        }
        const approvedPhase = authorizationSucceeded.phase();
        authorizationSucceeded.free();
        this.replacePhase(authorizingPhase, approvedPhase);
        await this.deliverApprovedGrant(approval, approvedPhase, publish);
        return;
      }

      await this.deliverApprovedGrant(approval, state.phase, publish);
    } finally {
      this.finishApproval();
      this.vault.isSaving = false;
    }
  }

  private async deliverApprovedGrant(
    approval: ExtensionVaultApproval,
    approvedPhase: NookExtensionConsentPhase,
    publish: (state: ExtensionConsentWorkflowState) => void,
  ): Promise<void> {
    if (
      !this.publish(
        {
          kind: ExtensionConsentWorkflowKind.PreparingGrant,
          phase: approvedPhase,
        },
        publish,
      )
    ) {
      return;
    }
    let prepared: Awaited<ReturnType<typeof approval.prepareAuthorizedGrant>>;
    try {
      prepared = await approval.prepareAuthorizedGrant();
    } catch (failure) {
      if (!this.isApproving()) return;
      this.publish(
        {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.GrantPreparation,
            failure: new NativeVaultStorageFailure(failure),
          },
        },
        publish,
      );
      return;
    }
    if (!this.isApproving()) return;
    if (prepared.isErr()) {
      this.publish(
        {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.GrantPreparation,
            failure: prepared.error,
          },
        },
        publish,
      );
      return;
    }

    if (
      !this.publish(
        {
          kind: ExtensionConsentWorkflowKind.DeliveringGrant,
          phase: approvedPhase,
        },
        publish,
      )
    ) {
      return;
    }
    let delivered: Awaited<ReturnType<typeof approval.deliver>>;
    try {
      delivered = await approval.deliver(prepared.value);
    } catch {
      if (!this.isApproving()) return;
      this.publish(
        {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: { kind: ExtensionConsentWorkflowFailureKind.BrowserHandoff },
        },
        publish,
      );
      return;
    }
    if (!this.isApproving()) return;
    if (delivered.isErr()) {
      this.publish(
        {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.DeliveryAdmission,
            failure: delivered.error,
          },
        },
        publish,
      );
      return;
    }

    const outcome = deliveryOutcome(delivered.value);
    if (
      !this.publish(
        {
          kind: ExtensionConsentWorkflowKind.RefreshingDevices,
          phase: approvedPhase,
          outcome,
        },
        publish,
      )
    ) {
      return;
    }
    let devices: Awaited<ReturnType<VaultState["refreshDeviceState"]>>;
    try {
      devices = await this.vault.refreshDeviceState();
    } catch (failure) {
      if (!this.isApproving()) return;
      this.publish(
        {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.DeviceRefresh,
            failure: new NativeVaultStorageFailure(failure),
          },
        },
        publish,
      );
      return;
    }
    if (!this.isApproving()) return;
    if (devices.isErr()) {
      this.publish(
        {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.DeviceRefresh,
            failure: devices.error,
          },
        },
        publish,
      );
      return;
    }

    const completion = approval.admitCompletion();
    if (completion.isErr()) {
      this.publish(
        {
          kind: ExtensionConsentWorkflowKind.Failed,
          phase: approvedPhase,
          failure: {
            kind: ExtensionConsentWorkflowFailureKind.CompletionAdmission,
            failure: completion.error,
          },
        },
        publish,
      );
      return;
    }

    this.publish(
      {
        kind: ExtensionConsentWorkflowKind.Completed,
        phase: approvedPhase,
        outcome,
      },
      publish,
    );
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

  private replacePhase(
    previousPhase: NookExtensionConsentPhase,
    nextPhase: NookExtensionConsentPhase,
  ): void {
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

  private publish(
    state: ExtensionConsentWorkflowState,
    publish: (state: ExtensionConsentWorkflowState) => void,
  ): boolean {
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
        this.lifecycle.phase.free();
        this.lifecycle = { kind: ExtensionConsentWorkflowLifecycleKind.Disposed };
        return;
      case ExtensionConsentWorkflowLifecycleKind.NotStarted:
      case ExtensionConsentWorkflowLifecycleKind.Ready:
      case ExtensionConsentWorkflowLifecycleKind.Disposed:
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
    if (this.vault.isSaving)
      return NookExtensionConsentVaultReadiness.Saving;
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
