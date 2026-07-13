import { getEnrollmentLinkBase } from '$lib/enrollment-code'
import {
  buildSentinelGenesisParticipantResponseLink as buildParticipantResponseLinkCore,
  buildSentinelGenesisRequestLink as buildRequestLinkCore,
  normalizeSentinelGenesisRequest,
} from '$lib/nook-wasm/nook_wasm'

const SENTINEL_REQUEST_HASH_PREFIX = '#sentinel-request='

export function buildSentinelGenesisRequestLink(
  requestJson: string,
  baseUrl = getEnrollmentLinkBase(),
): string {
  if (!requestJson.trim()) return ''
  return buildRequestLinkCore(requestJson, baseUrl)
}

export function buildSentinelGenesisParticipantResponseLink(
  responseJson: string,
  baseUrl = getEnrollmentLinkBase(),
): string {
  if (!responseJson.trim()) return ''
  return buildParticipantResponseLinkCore(responseJson, baseUrl)
}

/**
 * Consume either the current fragment URL or the legacy query URL, then remove
 * the public ceremony request from browser history after Rust validates it.
 */
export function consumeSentinelGenesisRequestFromLocation(): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  const hasRequest =
    url.hash.startsWith(SENTINEL_REQUEST_HASH_PREFIX) ||
    url.searchParams.has('sentinel-request')
  if (!hasRequest) return ''

  try {
    const request = normalizeSentinelGenesisRequest(url.toString())
    url.hash = ''
    url.searchParams.delete('sentinel-request')
    history.replaceState(undefined, '', `${url.pathname}${url.search}`)
    return request
  } catch {
    return ''
  }
}
