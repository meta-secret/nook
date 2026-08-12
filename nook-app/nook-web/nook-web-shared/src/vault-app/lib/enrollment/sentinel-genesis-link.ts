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

import { getEnrollmentLinkBase } from "$lib/enrollment/code";
import {
  WorkspaceRoute,
  WorkspaceRouteLookupKind,
  workspacePath,
  workspaceRouteFromPath,
} from "$lib/app/workspace-route";
import {
  build_sentinel_genesis_participant_response_link,
  build_sentinel_genesis_request_link,
  normalize_sentinel_genesis_participant_payload,
  normalize_sentinel_genesis_request,
} from "$app-wasm";

const SENTINEL_REQUEST_HASH_PREFIX = "#sentinel-request=";
const SENTINEL_RESPONSE_HASH_PREFIX = "#sentinel-response=";

function sentinelGenesisLinkBase(): string {
  if (!("window" in globalThis)) return getEnrollmentLinkBase();
  const sentinelGenesisLinkBaseForWorkspaceArgs: Parameters<
    typeof sentinelGenesisLinkBaseForWorkspace
  >[0] = {
    enrollmentLinkBase: getEnrollmentLinkBase(),
    currentLocation: window.location.href,
  };
  return sentinelGenesisLinkBaseForWorkspace(
    sentinelGenesisLinkBaseForWorkspaceArgs,
  );
}

export function sentinelGenesisLinkBaseForWorkspace({
  enrollmentLinkBase,
  currentLocation,
}: SentinelGenesisWorkspaceLink): string {
  const url = new URL(enrollmentLinkBase);
  const workspace = new URL(currentLocation);
  // Workspace routing canonicalizes `/vault/` to `/vault`. Keep ceremony
  // links on the configured public origin and that same document so a response
  // URL changes only its fragment: a slash-only navigation would recreate the
  // app and lose the in-progress (intentionally in-memory) Genesis ceremony.
  const workspaceRoute = workspaceRouteFromPath(workspace.pathname);
  url.pathname =
    workspaceRoute.kind === WorkspaceRouteLookupKind.Workspace
      ? workspacePath(workspaceRoute.route)
      : workspacePath(WorkspaceRoute.Vault);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildSentinelGenesisRequestLink({
  requestJson,
  baseUrl = sentinelGenesisLinkBase(),
}: SentinelGenesisRequestLink): string {
  if (!requestJson.trim()) return "";
  return build_sentinel_genesis_request_link(requestJson, baseUrl);
}

export function buildSentinelGenesisParticipantResponseLink({
  responseJson,
  baseUrl = sentinelGenesisLinkBase(),
}: SentinelGenesisParticipantResponseLink): string {
  if (!responseJson.trim()) return "";
  return build_sentinel_genesis_participant_response_link(
    responseJson,
    baseUrl,
  );
}

/**
 * Consume either the current fragment URL or the legacy query URL, then remove
 * the public ceremony request from browser history after Rust validates it.
 */
export function consumeSentinelGenesisRequestFromLocation(): string {
  if (!("window" in globalThis)) return "";
  const url = new URL(window.location.href);
  const hasRequest =
    url.hash.startsWith(SENTINEL_REQUEST_HASH_PREFIX) ||
    url.searchParams.has("sentinel-request");
  if (!hasRequest) return "";

  try {
    const request = normalize_sentinel_genesis_request(url.toString());
    url.hash = "";
    url.searchParams.delete("sentinel-request");
    const replaceStateArgs: Parameters<typeof history.replaceState>[0] = {};
    history.replaceState(replaceStateArgs, "", `${url.pathname}${url.search}`);
    return request;
  } catch {
    return "";
  }
}

export function consumeSentinelGenesisParticipantResponseFromLocation(): string {
  if (!("window" in globalThis)) return "";
  const url = new URL(window.location.href);
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
    const replaceStateArgs2: Parameters<typeof history.replaceState>[0] = {};
    history.replaceState(replaceStateArgs2, "", `${url.pathname}${url.search}`);
    return response;
  } catch {
    return "";
  }
}
