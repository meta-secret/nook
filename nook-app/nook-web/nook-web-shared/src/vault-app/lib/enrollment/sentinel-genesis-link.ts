type SentinelGenesisWorkspaceLink = {
  readonly enrollmentLinkBase: string;
  readonly currentLocation: string;
};

type SentinelGenesisRequestLink = {
  readonly requestJson: string;
  readonly baseUrl?: string;
};

type SentinelGenesisParticipantResponseLink = {
  readonly responseJson: string;
  readonly baseUrl?: string;
};
import { enrollmentBrowser } from "$lib/enrollment/code";
import {
  WorkspaceRoute,
  WorkspaceRouteLookupKind,
  WorkspaceLocation,
  WorkspacePath,
} from "$lib/app/workspace-route";
import {
  build_sentinel_genesis_participant_response_link,
  build_sentinel_genesis_request_link,
  normalize_sentinel_genesis_participant_payload,
  normalize_sentinel_genesis_request,
} from "$app-wasm";

const SENTINEL_REQUEST_HASH_PREFIX = "#sentinel-request=";

const SENTINEL_RESPONSE_HASH_PREFIX = "#sentinel-response=";

/** Owns enrollment URL consumption and history cleanup for its browser host. */
class SentinelGenesisBrowser {
  constructor(private readonly browser: typeof globalThis) {}

  private sentinelGenesisLinkBase(): string {
    if (!("window" in this.browser))
      return enrollmentBrowser.getEnrollmentLinkBase();
    const sentinelGenesisLinkBaseForWorkspaceArgs: Parameters<
      typeof this.sentinelGenesisLinkBaseForWorkspace
    >[0] = {
      enrollmentLinkBase: enrollmentBrowser.getEnrollmentLinkBase(),
      currentLocation: this.browser.window.location.href,
    };
    return this.sentinelGenesisLinkBaseForWorkspace(
      sentinelGenesisLinkBaseForWorkspaceArgs,
    );
  }

  sentinelGenesisLinkBaseForWorkspace({
    enrollmentLinkBase,
    currentLocation,
  }: SentinelGenesisWorkspaceLink): string {
    const url = new URL(enrollmentLinkBase);
    const workspace = new URL(currentLocation);
    // Workspace routing canonicalizes `/vault/` to `/vault`. Keep ceremony
    // links on the configured public origin and that same document so a response
    // URL changes only its fragment: a slash-only navigation would recreate the
    // app and lose the in-progress (intentionally in-memory) Genesis ceremony.
    const workspaceRoute = new WorkspacePath(workspace.pathname).route;
    url.pathname =
      workspaceRoute.kind === WorkspaceRouteLookupKind.Workspace
        ? new WorkspaceLocation(workspaceRoute.route).path
        : new WorkspaceLocation(WorkspaceRoute.Vault).path;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  buildSentinelGenesisRequestLink({
    requestJson,
    baseUrl = this.sentinelGenesisLinkBase(),
  }: SentinelGenesisRequestLink): string {
    if (!requestJson.trim()) return "";
    return build_sentinel_genesis_request_link(requestJson, baseUrl);
  }

  buildSentinelGenesisParticipantResponseLink({
    responseJson,
    baseUrl = this.sentinelGenesisLinkBase(),
  }: SentinelGenesisParticipantResponseLink): string {
    if (!responseJson.trim()) return "";
    return build_sentinel_genesis_participant_response_link(
      responseJson,
      baseUrl,
    );
  }

  consumeSentinelGenesisRequestFromLocation(): string {
    if (!("window" in this.browser)) return "";
    const url = new URL(this.browser.window.location.href);
    const hasRequest =
      url.hash.startsWith(SENTINEL_REQUEST_HASH_PREFIX) ||
      url.searchParams.has("sentinel-request");
    if (!hasRequest) return "";

    try {
      const request = normalize_sentinel_genesis_request(url.toString());
      url.hash = "";
      url.searchParams.delete("sentinel-request");
      const replaceStateArgs: Parameters<
        typeof this.browser.history.replaceState
      >[0] = {};
      this.browser.history.replaceState(
        replaceStateArgs,
        "",
        `${url.pathname}${url.search}`,
      );
      return request;
    } catch {
      return "";
    }
  }

  consumeSentinelGenesisParticipantResponseFromLocation(): string {
    if (!("window" in this.browser)) return "";
    const url = new URL(this.browser.window.location.href);
    const hasResponse =
      url.hash.startsWith(SENTINEL_RESPONSE_HASH_PREFIX) ||
      url.searchParams.has("sentinel-response");
    if (!hasResponse) return "";

    try {
      const response = normalize_sentinel_genesis_participant_payload(
        url.toString(),
      );
      url.hash = "";
      url.searchParams.delete("sentinel-response");
      const replaceStateArgs2: Parameters<
        typeof this.browser.history.replaceState
      >[0] = {};
      this.browser.history.replaceState(
        replaceStateArgs2,
        "",
        `${url.pathname}${url.search}`,
      );
      return response;
    } catch {
      return "";
    }
  }
}

export const sentinelGenesisBrowser = new SentinelGenesisBrowser(globalThis);
