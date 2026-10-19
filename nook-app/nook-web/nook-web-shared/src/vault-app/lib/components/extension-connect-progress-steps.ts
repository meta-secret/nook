import {
  ExtensionConnectFailureReason,
  ExtensionConnectStepKind,
  type ExtensionConnectStep,
} from "$web-shared/extension/extension-connect-progress";
import {
  ExtensionConsentDeliveryOutcomeKind,
  ExtensionConsentWorkflowFailureKind,
  ExtensionConsentWorkflowKind,
  type ExtensionConsentDeliveryOutcome,
  type ExtensionConsentWorkflowFailure,
  type ExtensionConsentWorkflowState,
} from "./extension-connect-consent-workflow";

/** Whether this browser holds a vault the connect page can unlock. */
export enum ExtensionConnectBrowserVaults {
  Held = "held",
  None = "none",
}

/** Whether the access gate is busy setting up or opening a vault. */
export enum ExtensionConnectAccessActivity {
  Idle = "idle",
  Busy = "busy",
}

export type ExtensionConnectAccessRequest = {
  readonly vaults: ExtensionConnectBrowserVaults;
  readonly activity: ExtensionConnectAccessActivity;
};

/**
 * The connect page's step for the side panel, read from what the page
 * shows. This only names progress for display; the consent workflow and
 * Rust/WASM approval stay the authority.
 */
export class ExtensionConnectPageSteps {
  private constructor() {}

  /** Before a vault is open: unlock the identity, or create or join. */
  static access(request: ExtensionConnectAccessRequest): ExtensionConnectStep {
    switch (request.vaults) {
      case ExtensionConnectBrowserVaults.Held:
        return { kind: ExtensionConnectStepKind.Unlock };
      case ExtensionConnectBrowserVaults.None:
        break;
    }
    switch (request.activity) {
      case ExtensionConnectAccessActivity.Idle:
        return { kind: ExtensionConnectStepKind.Choosing };
      case ExtensionConnectAccessActivity.Busy:
        return { kind: ExtensionConnectStepKind.Creating };
    }
  }

  /** A new identity is being created from the identities hub. */
  static newIdentity(): ExtensionConnectStep {
    return { kind: ExtensionConnectStepKind.Creating };
  }

  /** The consent workflow: approved only once the extension took the
   * grant and event log. */
  static consent(state: ExtensionConsentWorkflowState): ExtensionConnectStep {
    switch (state.kind) {
      case ExtensionConsentWorkflowKind.Resting:
      case ExtensionConsentWorkflowKind.SubmittingAuthorization:
      case ExtensionConsentWorkflowKind.PreparingGrant:
      case ExtensionConsentWorkflowKind.DeliveringGrant:
        return { kind: ExtensionConnectStepKind.Consent };
      // Device refresh starts only after a delivered grant.
      case ExtensionConsentWorkflowKind.RefreshingDevices:
      case ExtensionConsentWorkflowKind.Completed:
        return ExtensionConnectPageSteps.delivery(state.outcome);
      case ExtensionConsentWorkflowKind.Failed:
        return ExtensionConnectPageSteps.failure(state.failure);
    }
  }

  private static delivery(
    outcome: ExtensionConsentDeliveryOutcome,
  ): ExtensionConnectStep {
    switch (outcome.kind) {
      case ExtensionConsentDeliveryOutcomeKind.Delivered:
        return { kind: ExtensionConnectStepKind.Approved };
      case ExtensionConsentDeliveryOutcomeKind.MessagingUnavailable:
      case ExtensionConsentDeliveryOutcomeKind.Rejected:
        return {
          kind: ExtensionConnectStepKind.Failed,
          reason: ExtensionConnectFailureReason.Delivery,
        };
    }
  }

  private static failure(
    failure: ExtensionConsentWorkflowFailure,
  ): ExtensionConnectStep {
    switch (failure.kind) {
      case ExtensionConsentWorkflowFailureKind.Authorization:
      case ExtensionConsentWorkflowFailureKind.ProviderTransition:
        return {
          kind: ExtensionConnectStepKind.Failed,
          reason: ExtensionConnectFailureReason.Authorization,
        };
      case ExtensionConsentWorkflowFailureKind.GrantPreparation:
      case ExtensionConsentWorkflowFailureKind.DeviceRefresh:
      case ExtensionConsentWorkflowFailureKind.CompletionAdmission:
        return {
          kind: ExtensionConnectStepKind.Failed,
          reason: ExtensionConnectFailureReason.Grant,
        };
      case ExtensionConsentWorkflowFailureKind.DeliveryAdmission:
      case ExtensionConsentWorkflowFailureKind.NonDeliveryOutcome:
      case ExtensionConsentWorkflowFailureKind.BrowserHandoff:
        return {
          kind: ExtensionConnectStepKind.Failed,
          reason: ExtensionConnectFailureReason.Delivery,
        };
    }
  }
}
