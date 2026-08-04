import { getEnrollmentLinkBase } from "$lib/enrollment/code";
import {
  buildSentinelGenesisParticipantResponseLink as buildParticipantResponseLinkCore,
  buildSentinelGenesisRequestLink as buildRequestLinkCore,
  normalizeSentinelGenesisParticipantPayload,
  normalizeSentinelGenesisRequest,
} from "$app-wasm";

const SENTINEL_REQUEST_HASH_PREFIX = "#sentinel-request=";
const SENTINEL_RESPONSE_HASH_PREFIX = "#sentinel-response=";

function sentinelGenesisLinkBase(): string {
  if (!("window" in globalThis)) return getEnrollmentLinkBase();
  const url = new URL(window.location.href);
  // Workspace routing canonicalizes `/vault/` to `/vault`. Keep ceremony
  // links on that same document so a response URL changes only its fragment:
  // a slash-only navigation would recreate the app and lose the in-progress
  // (intentionally in-memory) Genesis ceremony.
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildSentinelGenesisRequestLink(
  requestJson: string,
  baseUrl = sentinelGenesisLinkBase(),
): string {
  if (!requestJson.trim()) return "";
  return buildRequestLinkCore(requestJson, baseUrl);
}

export function buildSentinelGenesisParticipantResponseLink(
  responseJson: string,
  baseUrl = sentinelGenesisLinkBase(),
): string {
  if (!responseJson.trim()) return "";
  return buildParticipantResponseLinkCore(responseJson, baseUrl);
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
    const request = normalizeSentinelGenesisRequest(url.toString());
    url.hash = "";
    url.searchParams.delete("sentinel-request");
    history.replaceState({}, "", `${url.pathname}${url.search}`);
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
    const response = normalizeSentinelGenesisParticipantPayload(url.toString());
    url.hash = "";
    url.searchParams.delete("sentinel-response");
    history.replaceState({}, "", `${url.pathname}${url.search}`);
    return response;
  } catch {
    return "";
  }
}
