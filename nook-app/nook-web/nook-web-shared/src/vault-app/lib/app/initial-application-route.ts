import { AppLogsLocation } from "$lib/app/logs-api";
import {
  initialExtensionConnectIntent,
  initialLegalRoute,
} from "$lib/app/route-state";
import { ApplicationRoutePresentation } from "$lib/content/legal";
import { sentinelGenesisBrowser } from "$lib/enrollment/sentinel-genesis-link";
import { sentinelOnboardingBrowser } from "$lib/enrollment/sentinel-onboarding-link";
import { extensionConnectionBrowser } from "$lib/extension/connect";

type InitialApplicationRouteRequest = {
  isSimpleApplication: boolean;
  supportsExtension: boolean;
};

/** Reads the browser location once to produce one coherent startup route snapshot. */
export class InitialApplicationRoute {
  constructor(private readonly request: InitialApplicationRouteRequest) {}

  read() {
    const browserReady = "window" in globalThis;
    const path = browserReady ? window.location.pathname : "";
    const sentinelLocation = browserReady && !this.request.isSimpleApplication;
    return {
      legalPage: initialLegalRoute(),
      logsPage:
        browserReady && new ApplicationRoutePresentation(path).isLogsPath(),
      appLogsPage: browserReady && new AppLogsLocation(path).matches,
      extensionConnectRoute:
        browserReady &&
        this.request.supportsExtension &&
        extensionConnectionBrowser.isExtensionConnectPath(path),
      extensionConnectIntent: initialExtensionConnectIntent(
        this.request.supportsExtension,
      ),
      sentinelInvitationRequest: sentinelLocation
        ? sentinelGenesisBrowser.consumeSentinelGenesisRequestFromLocation()
        : "",
      sentinelParticipantResponse: sentinelLocation
        ? sentinelGenesisBrowser.consumeSentinelGenesisParticipantResponseFromLocation()
        : "",
      sentinelOnboardingPackage: sentinelLocation
        ? sentinelOnboardingBrowser.consumeSentinelOnboardingFromLocation()
        : "",
    };
  }
}
