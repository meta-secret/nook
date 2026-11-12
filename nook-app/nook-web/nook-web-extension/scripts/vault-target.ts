import {
  admit_simple_vault_target_for_production,
  default_simple_vault_target_name,
  ExtensionPackageDistribution,
  ExtensionPackageHost,
  resolve_simple_vault_target,
  simple_vault_target_downloads_suffix,
  simple_vault_target_extension_identity,
  simple_vault_target_extension_metadata_file_name,
  simple_vault_target_package_distribution,
  simple_vault_target_package_host,
  type ExtensionIdentityScope,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  ExtensionReleaseChannel,
  type ExtensionChannel,
} from './channel-identity'

/** The one Simple vault an extension build pairs with, and its package facts. */
export type ExtensionVaultTarget = {
  readonly simpleVaultBaseUrl: string
  readonly downloadsSuffix: string
  readonly metadataFileName: string
  readonly distribution: ExtensionPackageDistribution
  /** The public site, or the Simple vault artifact on the target's own host. */
  readonly packageHost: ExtensionPackageHost
  readonly identityScope: ExtensionIdentityScope
}

// Docker build arguments and Task pass-through turn an unset variable into
// an empty string, so an empty value selects the default target too.
function requestedVaultTarget(input: string): string {
  return input.trim() || default_simple_vault_target_name()
}

/**
 * Resolve the builder's vault input (`NOOK_EXTENSION_VAULT`): a known target
 * name or an absolute Simple vault URL. Companion WASM owns the names, the
 * default, URL validation, and every package fact; an unknown name throws its
 * diagnostic. Callers acquire companion WASM readiness first.
 */
export function resolveExtensionVaultTarget(
  input: string,
): ExtensionVaultTarget {
  const requested = requestedVaultTarget(input)
  return {
    simpleVaultBaseUrl: resolve_simple_vault_target(requested),
    downloadsSuffix: simple_vault_target_downloads_suffix(requested),
    metadataFileName:
      simple_vault_target_extension_metadata_file_name(requested),
    distribution: simple_vault_target_package_distribution(requested),
    packageHost: simple_vault_target_package_host(requested),
    identityScope: simple_vault_target_extension_identity(requested),
  }
}

/**
 * Resolve the vault target of a package published on `channel`. A production
 * package must name its Simple vault: companion WASM refuses any other URL, so
 * the production identity never binds to an arbitrary origin.
 */
export function resolvePublishedExtensionVaultTarget(
  input: string,
  channel: ExtensionChannel,
): ExtensionVaultTarget {
  const requested = requestedVaultTarget(input)
  if (channel === ExtensionReleaseChannel.Production) {
    admit_simple_vault_target_for_production(requested)
  }
  return resolveExtensionVaultTarget(requested)
}

/** The vault target this process builds or verifies. */
export function extensionVaultTargetFromEnvironment(): ExtensionVaultTarget {
  return resolveExtensionVaultTarget(process.env.NOOK_EXTENSION_VAULT || '')
}
