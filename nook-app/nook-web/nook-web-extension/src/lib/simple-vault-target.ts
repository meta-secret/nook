import '../../../nook-web-shared/src/extension/companion-ready'
import {
  belongsToSentinelVault as wasmBelongsToSentinelVault,
  belongsToSimpleVault as wasmBelongsToSimpleVault,
  defaultSimpleVaultUrl,
  isNookVaultAppUrl as wasmIsNookVaultAppUrl,
  isSentinelVaultHostname as wasmIsSentinelVaultHostname,
  isSimpleVaultHostname as wasmIsSimpleVaultHostname,
  matchingSentinelVaultBaseUrl as wasmMatchingSentinelVaultBaseUrl,
  nookVaultAppExcludeMatchPatterns as wasmNookVaultAppExcludeMatchPatterns,
  normalizeSimpleVaultBaseUrl as wasmNormalizeSimpleVaultBaseUrl,
  sentinelVaultMatchPatterns as wasmSentinelVaultMatchPatterns,
  simpleVaultMatchPattern as wasmSimpleVaultMatchPattern,
  simpleVaultUrl as wasmSimpleVaultUrl,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export function defaultSimpleVaultBaseUrl(): string {
  return defaultSimpleVaultUrl()
}

export function normalizeSimpleVaultBaseUrl(value: string): string {
  return wasmNormalizeSimpleVaultBaseUrl(value)
}

export function simpleVaultUrl(baseUrl: string, path = ''): string {
  return wasmSimpleVaultUrl(baseUrl, path)
}

export function simpleVaultMatchPattern(baseUrl: string): string {
  return wasmSimpleVaultMatchPattern(baseUrl)
}

export function sentinelVaultBaseUrl(baseUrl: string): string {
  const matching = wasmMatchingSentinelVaultBaseUrl(baseUrl)
  if (!matching) {
    throw new Error(
      'No matching Sentinel Vault URL for this Simple Vault base.',
    )
  }
  return matching
}

export function sentinelVaultMatchPatterns(baseUrl: string): string[] {
  return wasmSentinelVaultMatchPatterns(baseUrl)
}

export function nookVaultAppExcludeMatchPatterns(baseUrl: string): string[] {
  return wasmNookVaultAppExcludeMatchPatterns(baseUrl)
}

export function isSimpleVaultHostname(hostname: string): boolean {
  return wasmIsSimpleVaultHostname(hostname)
}

export function isSentinelVaultHostname(hostname: string): boolean {
  return wasmIsSentinelVaultHostname(hostname)
}

export function isNookVaultAppUrl(candidateUrl: string, baseUrl = ''): boolean {
  return wasmIsNookVaultAppUrl(candidateUrl, baseUrl)
}

export function belongsToSimpleVault(
  baseUrl: string,
  candidateUrl: string,
): boolean {
  return wasmBelongsToSimpleVault(baseUrl, candidateUrl)
}

export function belongsToSentinelVault(
  baseUrl: string,
  candidateUrl: string,
): boolean {
  return wasmBelongsToSentinelVault(baseUrl, candidateUrl)
}
