import { AppLogsLocation } from "$lib/app/logs-api";
import {
  ExtensionConnectIntentKind,
  ExtensionConnectionIntentProjection,
  type ExtensionConnectIntent,
} from "$lib/app/route-state";
import { LegalRouteKind, LegalRouteProjection } from "$lib/app/route-state";
import {
  ExtensionConnectRequestStateKind,
  extensionConnectionBrowser as connectionBrowser,
  type ExtensionConnectRequestState,
} from "$lib/extension/connect";
import { ApplicationRoutePresentation as ApplicationRoute } from "$lib/content/legal";
import { sentinelGenesisBrowser } from "$lib/enrollment/sentinel-genesis-link";
import { sentinelOnboardingBrowser } from "$lib/enrollment/sentinel-onboarding-link";
import {
  WorkspaceLocation,
  WorkspacePath,
  WorkspaceRoute,
  WorkspaceRouteLookupKind,
} from "$lib/app/workspace-route";
import { InitialApplicationRoute } from "$lib/app/initial-application-route";
import { ExtensionConsentCloseOutcome } from "$lib/components/extension-connect-consent-outcome";
import { VaultWorkspaceActions } from "$lib/vault/ui";
import type { VaultState } from "$lib/vault.svelte";

export type VaultAppRouteCoordinatorRequest = {
  readonly vault: VaultState;
  readonly isSimpleApplication: boolean;
  readonly supportsExtension: boolean;
  readonly isSentinelParticipantResponsePending: () => boolean;
  readonly isSentinelParticipantKeyPending: () => boolean;
  readonly finishPendingCreation: () => void;
};

/** Owns browser-location projection and navigation for the vault shell. */
export class VaultAppRouteCoordinator {
  legalPageState = $state<
    ReturnType<InitialApplicationRoute["read"]>["legalPage"]
  >({
    kind: LegalRouteKind.Application,
  });
  logsPage = $state(false);
  appLogsPage = $state(false);
  extensionConnectRoute = $state(false);
  extensionConnectRequestState = $state<ExtensionConnectIntent>({
    kind: ExtensionConnectIntentKind.Absent,
  });
  extensionIdentityRequestState = $state<ExtensionConnectIntent>({
    kind: ExtensionConnectIntentKind.Absent,
  });
  sentinelInvitationRequest = $state("");
  sentinelParticipantResponse = $state("");
  sentinelOnboardingPackage = $state("");

  private readonly request: VaultAppRouteCoordinatorRequest;

  constructor(request: VaultAppRouteCoordinatorRequest) {
    this.request = request;
    const initialApplicationRouteRequest: ConstructorParameters<
      typeof InitialApplicationRoute
    >[0] = {
      isSimpleApplication: request.isSimpleApplication,
      supportsExtension: request.supportsExtension,
    };
    const initialRoute = new InitialApplicationRoute(
      initialApplicationRouteRequest,
    ).read();
    this.legalPageState = initialRoute.legalPage;
    this.logsPage = initialRoute.logsPage;
    this.appLogsPage = initialRoute.appLogsPage;
    this.extensionConnectRoute = initialRoute.extensionConnectRoute;
    this.extensionConnectRequestState = initialRoute.extensionConnectIntent;
    this.extensionIdentityRequestState = initialRoute.extensionConnectIntent;
    this.sentinelInvitationRequest = initialRoute.sentinelInvitationRequest;
    this.sentinelParticipantResponse = initialRoute.sentinelParticipantResponse;
    this.sentinelOnboardingPackage = initialRoute.sentinelOnboardingPackage;
  }

  // This is an EventListener boundary; browser lifecycle supplies the optional event.
  syncRoute = (event?: Event): void => {
    if (!this.request.isSimpleApplication) {
      const invitationRequest =
        sentinelGenesisBrowser.consumeSentinelGenesisRequestFromLocation();
      if (invitationRequest || event?.type === "popstate") {
        this.sentinelInvitationRequest = invitationRequest;
        if (this.request.isSentinelParticipantResponsePending())
          this.request.finishPendingCreation();
      }
      const participantResponse =
        sentinelGenesisBrowser.consumeSentinelGenesisParticipantResponseFromLocation();
      if (participantResponse)
        this.sentinelParticipantResponse = participantResponse;
      const onboardingPackage =
        sentinelOnboardingBrowser.consumeSentinelOnboardingFromLocation();
      if (onboardingPackage) this.sentinelOnboardingPackage = onboardingPackage;
    }
    this.legalPageState = new LegalRouteProjection(
      new ApplicationRoute(window.location.pathname).getLegalPageFromPath(),
    ).route;
    this.logsPage = new ApplicationRoute(window.location.pathname).isLogsPath();
    this.appLogsPage = new AppLogsLocation(window.location.pathname).matches;
    this.extensionConnectRoute =
      this.request.supportsExtension &&
      connectionBrowser.isExtensionConnectPath(window.location.pathname);
    const workspaceRoute = new WorkspacePath(window.location.pathname).route;
    const leavesSentinelChooser =
      this.legalPageState.kind !== LegalRouteKind.Application ||
      this.logsPage ||
      this.appLogsPage ||
      this.extensionConnectRoute ||
      (workspaceRoute.kind === WorkspaceRouteLookupKind.Workspace &&
        workspaceRoute.route !== WorkspaceRoute.Vault);
    if (leavesSentinelChooser && this.request.isSentinelParticipantKeyPending())
      this.request.finishPendingCreation();
    if (
      this.legalPageState.kind === LegalRouteKind.Application &&
      !this.logsPage &&
      !this.appLogsPage &&
      !this.extensionConnectRoute
    ) {
      const route =
        workspaceRoute.kind === WorkspaceRouteLookupKind.Workspace
          ? workspaceRoute.route
          : WorkspaceRoute.Vault;
      const workspaceRouteRequest: Parameters<
        VaultWorkspaceActions["applyWorkspaceRoute"]
      >[0] = {
        route,
      };
      new VaultWorkspaceActions(this.request.vault).applyWorkspaceRoute(
        workspaceRouteRequest,
      );
      const emptyHistoryState: Record<PropertyKey, never> = {};
      history.replaceState(
        emptyHistoryState,
        "",
        new WorkspaceLocation(route).path,
      );
    }
    const routeConnectRequest: ExtensionConnectRequestState = this.request
      .supportsExtension
      ? connectionBrowser.extensionConnectRequestFromLocation(window.location)
      : { kind: ExtensionConnectRequestStateKind.Absent };
    this.extensionConnectRequestState = new ExtensionConnectionIntentProjection(
      routeConnectRequest,
    ).intent;
    if (routeConnectRequest.kind === ExtensionConnectRequestStateKind.Requested)
      this.extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Requested,
        request: routeConnectRequest.request,
      };
  };

  navigateHome = (): void => {
    this.navigateToVault();
  };

  finishExtensionConnect = (outcome: ExtensionConsentCloseOutcome): void => {
    if (outcome === ExtensionConsentCloseOutcome.Cancelled) {
      this.extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Absent,
      };
    }
    this.navigateToVault();
  };

  private navigateToVault(): void {
    const vaultWorkspaceRouteRequest: Parameters<
      VaultWorkspaceActions["applyWorkspaceRoute"]
    >[0] = {
      route: WorkspaceRoute.Vault,
    };
    new VaultWorkspaceActions(this.request.vault).applyWorkspaceRoute(
      vaultWorkspaceRouteRequest,
    );
    const emptyHistoryState: Record<PropertyKey, never> = {};
    history.pushState(
      emptyHistoryState,
      "",
      new WorkspaceLocation(WorkspaceRoute.Vault).path,
    );
    this.legalPageState = { kind: LegalRouteKind.Application };
    this.logsPage = false;
    this.appLogsPage = false;
    this.extensionConnectRoute = false;
    this.extensionConnectRequestState = {
      kind: ExtensionConnectIntentKind.Absent,
    };
  }
}
