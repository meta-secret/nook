import {
  belongsToSentinelVault,
  belongsToSimpleVault,
  normalizeSimpleVaultBaseUrl,
  simpleVaultUrl,
} from './simple-vault-target'

export const SIMPLE_VAULT_BASE_URL = normalizeSimpleVaultBaseUrl(
  __NOOK_SIMPLE_VAULT_URL__,
)

export function runtimeSimpleVaultUrl(path = ''): string {
  return simpleVaultUrl(SIMPLE_VAULT_BASE_URL, path)
}

export function isRuntimeSimpleVaultUrl(candidateUrl: string): boolean {
  return belongsToSimpleVault(SIMPLE_VAULT_BASE_URL, candidateUrl)
}

export function isRuntimeSentinelVaultUrl(candidateUrl: string): boolean {
  return belongsToSentinelVault(SIMPLE_VAULT_BASE_URL, candidateUrl)
}
