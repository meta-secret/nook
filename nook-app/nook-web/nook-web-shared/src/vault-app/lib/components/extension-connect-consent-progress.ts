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

/**
 * The consent's step for the side panel. Only ExtensionConnectConsent
 * imports it, so it stays out of the Sentinel Vault with the consent. This
 * only names progress for display; the consent workflow and Rust/WASM
 * approval stay the authority.
 */
export class ExtensionConnectConsentSteps {
  private constructor() {}

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
        return ExtensionConnectConsentSteps.delivery(state.outcome);
      case ExtensionConsentWorkflowKind.Failed:
        return ExtensionConnectConsentSteps.failure(state.failure);
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
