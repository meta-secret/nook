import {
  ExtensionConnectStepKind,
  type ExtensionConnectStep,
} from "$web-shared/extension/extension-connect-progress";
import { ExtensionConnectIntentKind } from "../app/route-state";
import { FirstRunStage, NewIdentityStage } from "../vault/state/ui.svelte";
import type { VaultState } from "../vault.svelte";

/** Whether this browser holds a vault the connect page can unlock. */
export enum ExtensionConnectBrowserVaults {
  Held = "held",
  None = "none",
}

/** Whether the person started creating a vault on this page. Loading the
 * app or checking a vault is not creating one. */
export enum ExtensionConnectVaultCreation {
  None = "none",
  Underway = "underway",
}

export type ExtensionConnectAccessRequest = {
  readonly vaults: ExtensionConnectBrowserVaults;
  readonly creation: ExtensionConnectVaultCreation;
};

/** The vault state the connect page's step is read from. */
export type ExtensionConnectPageVault = Pick<
  VaultState,
  | "newIdentity"
  | "isAuthenticated"
  | "localVaultPresent"
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
    const creation = ExtensionConnectPageSteps.creation(view);
    switch (creation) {
      case ExtensionConnectVaultCreation.Underway:
        break;
      case ExtensionConnectVaultCreation.None:
        // While the app starts nothing is known yet: the page stays opened.
        switch (view.vault.isInitializing) {
          case true:
            return ExtensionConnectPageSteps.SILENT;
          case false:
            break;
        }
    }
    const access: ExtensionConnectAccessRequest = {
      vaults: ExtensionConnectPageSteps.vaults(view),
      creation,
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

  /** Creating a vault: its first-run setup runs, or the creation waits
   * for this device's key. */
  private static creation(
    view: ExtensionConnectPageView,
  ): ExtensionConnectVaultCreation {
    switch (view.preserveAccessGate) {
      case true:
        return ExtensionConnectVaultCreation.Underway;
      case false:
        break;
    }
    switch (view.vault.firstRun) {
      case FirstRunStage.Off:
        return ExtensionConnectVaultCreation.None;
      case FirstRunStage.Protect:
      case FirstRunStage.Sync:
      case FirstRunStage.Name:
      case FirstRunStage.Joining:
      case FirstRunStage.Connect:
        return ExtensionConnectVaultCreation.Underway;
    }
  }

  /** Before a vault is open: creating one, unlocking the identity, or
   * choosing to create or join. */
  static access(request: ExtensionConnectAccessRequest): ExtensionConnectStep {
    switch (request.creation) {
      case ExtensionConnectVaultCreation.Underway:
        return { kind: ExtensionConnectStepKind.Creating };
      case ExtensionConnectVaultCreation.None:
        break;
    }
    switch (request.vaults) {
      case ExtensionConnectBrowserVaults.Held:
        return { kind: ExtensionConnectStepKind.Unlock };
      case ExtensionConnectBrowserVaults.None:
        return { kind: ExtensionConnectStepKind.Choosing };
    }
  }

  /** A new identity is being created from the identities hub. */
  static newIdentity(): ExtensionConnectStep {
    return { kind: ExtensionConnectStepKind.Creating };
  }
}
