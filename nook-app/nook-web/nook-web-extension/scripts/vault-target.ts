import {
  default_simple_vault_target_name,
  ExtensionPackageDistribution,
  resolve_simple_vault_target,
  simple_vault_target_downloads_suffix,
  simple_vault_target_extension_identity,
  simple_vault_target_extension_metadata_file_name,
  simple_vault_target_package_distribution,
  type ExtensionIdentityScope,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/**
 * Where a target's deployment package is published. The default package
 * lives on the public site. A target with its own download names lives in
 * the Simple vault artifact, so the vault on that host offers it.
 */
export enum ExtensionPackageHost {
  Site = 'site',
  SimpleVault = 'simple-vault',
}

/** The one Simple vault an extension build pairs with, and its package facts. */
export type ExtensionVaultTarget = {
  readonly simpleVaultBaseUrl: string
  readonly downloadsSuffix: string
  readonly metadataFileName: string
  readonly distribution: ExtensionPackageDistribution
  readonly identityScope: ExtensionIdentityScope
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
  // Docker build arguments and Task pass-through turn an unset variable into
  // an empty string, so an empty value selects the default target too.
  const requested = input.trim() || default_simple_vault_target_name()
  return {
    simpleVaultBaseUrl: resolve_simple_vault_target(requested),
    downloadsSuffix: simple_vault_target_downloads_suffix(requested),
    metadataFileName:
      simple_vault_target_extension_metadata_file_name(requested),
    distribution: simple_vault_target_package_distribution(requested),
    identityScope: simple_vault_target_extension_identity(requested),
  }
}

/** The vault target this process builds, packages, or verifies. */
export function extensionVaultTargetFromEnvironment(): ExtensionVaultTarget {
  return resolveExtensionVaultTarget(process.env.NOOK_EXTENSION_VAULT || '')
}

/** Rust gives the default package no download suffix; it alone uses the site. */
export function extensionPackageHost(
  target: ExtensionVaultTarget,
): ExtensionPackageHost {
  return target.downloadsSuffix.length === 0
    ? ExtensionPackageHost.Site
    : ExtensionPackageHost.SimpleVault
}
