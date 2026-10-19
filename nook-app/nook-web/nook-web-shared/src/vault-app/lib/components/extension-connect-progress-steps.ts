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
import { ExtensionConnectIntentKind } from "../app/route-state";
import { FirstRunStage, NewIdentityStage } from "../vault/state/ui.svelte";
import type { VaultState } from "../vault.svelte";

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

/** The vault state the connect page's step is read from. */
export type ExtensionConnectPageVault = Pick<
  VaultState,
  | "newIdentity"
  | "isAuthenticated"
  | "localVaultPresent"
  | "isVerifying"
  | "isInitializing"
  | "firstRun"
>;

/** What the app shell shows, as the connect page's step depends on it. */
export type ExtensionConnectPageView = {
  /** The browser is on the connect route. */
  readonly connectRoute: boolean;
  readonly intent: ExtensionConnectIntentKind;
  /** The access gate stays up while a vault waits for this device. */
  readonly preserveAccessGate: boolean;
  readonly localVaultCount: number;
  readonly vault: ExtensionConnectPageVault;
};

export enum ExtensionConnectPageReportKind {
  /** Nothing for the shell to report: no connect, or the consent reports. */
  Silent = "silent",
  Report = "report",
}

export type ExtensionConnectPageReport =
  | { readonly kind: ExtensionConnectPageReportKind.Silent }
  | {
      readonly kind: ExtensionConnectPageReportKind.Report;
      readonly step: ExtensionConnectStep;
    };

enum ExtensionConnectPageSurface {
  AccessGate = "access-gate",
  /** The consent workspace reports its own steps. */
  Consent = "consent",
}

/**
 * The connect page's step for the side panel, read from what the page
 * shows. This only names progress for display; the consent workflow and
 * Rust/WASM approval stay the authority.
 */
export class ExtensionConnectPageSteps {
  private constructor() {}

  private static readonly SILENT: ExtensionConnectPageReport = {
    kind: ExtensionConnectPageReportKind.Silent,
  };

  /** The shell's report for the connect route, outside the consent. */
  static page(view: ExtensionConnectPageView): ExtensionConnectPageReport {
    switch (view.connectRoute) {
      case false:
        return ExtensionConnectPageSteps.SILENT;
      case true:
        break;
    }
    switch (view.intent) {
      case ExtensionConnectIntentKind.Absent:
        return ExtensionConnectPageSteps.SILENT;
      case ExtensionConnectIntentKind.Requested:
        break;
    }
    switch (view.vault.newIdentity) {
      case NewIdentityStage.Off:
        break;
      case NewIdentityStage.Name:
      case NewIdentityStage.Key:
      case NewIdentityStage.Ready:
        return ExtensionConnectPageSteps.reported(
          ExtensionConnectPageSteps.newIdentity(),
        );
    }
    switch (ExtensionConnectPageSteps.surface(view)) {
      case ExtensionConnectPageSurface.Consent:
        return ExtensionConnectPageSteps.SILENT;
      case ExtensionConnectPageSurface.AccessGate:
        break;
    }
    const access: ExtensionConnectAccessRequest = {
      vaults: ExtensionConnectPageSteps.vaults(view),
      activity: ExtensionConnectPageSteps.activity(view),
    };
    return ExtensionConnectPageSteps.reported(
      ExtensionConnectPageSteps.access(access),
    );
  }

  private static reported(
    step: ExtensionConnectStep,
  ): ExtensionConnectPageReport {
    return { kind: ExtensionConnectPageReportKind.Report, step };
  }

  private static surface(
    view: ExtensionConnectPageView,
  ): ExtensionConnectPageSurface {
    switch (view.vault.isAuthenticated) {
      case false:
        return ExtensionConnectPageSurface.AccessGate;
      case true:
        break;
    }
    switch (view.preserveAccessGate) {
      case true:
        return ExtensionConnectPageSurface.AccessGate;
      case false:
        return ExtensionConnectPageSurface.Consent;
    }
  }

  private static vaults(
    view: ExtensionConnectPageView,
  ): ExtensionConnectBrowserVaults {
    switch (view.vault.localVaultPresent) {
      case true:
        return ExtensionConnectBrowserVaults.Held;
      case false:
        break;
    }
    switch (view.localVaultCount) {
      case 0:
        return ExtensionConnectBrowserVaults.None;
      default:
        return ExtensionConnectBrowserVaults.Held;
    }
  }

  /** Busy while verifying, initializing, waiting for this device, or in
   * first-vault setup. */
  private static activity(
    view: ExtensionConnectPageView,
  ): ExtensionConnectAccessActivity {
    const { vault } = view;
    const busy = [
      vault.isVerifying,
      vault.isInitializing,
      view.preserveAccessGate,
    ].includes(true);
    switch (busy) {
      case true:
        return ExtensionConnectAccessActivity.Busy;
      case false:
        break;
    }
    switch (vault.firstRun) {
      case FirstRunStage.Off:
        return ExtensionConnectAccessActivity.Idle;
      case FirstRunStage.Protect:
      case FirstRunStage.Backup:
        return ExtensionConnectAccessActivity.Busy;
    }
  }

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
