import {
  default_simple_vault_target_name,
  resolve_simple_vault_target,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/**
 * Download names of one build's deployment package. The default target and
 * URL-form inputs keep the unsuffixed names that installers and the landing
 * page read; another named target adds its name so both packages coexist.
 */
export enum ExtensionVaultDownloadsKind {
  Default = 'default',
  Named = 'named',
}

type ExtensionVaultDownloads =
  | { readonly kind: ExtensionVaultDownloadsKind.Default }
  | { readonly kind: ExtensionVaultDownloadsKind.Named; readonly name: string }

/** The one Simple vault an extension build pairs with. */
export type ExtensionVaultTarget = {
  readonly simpleVaultBaseUrl: string
  readonly downloads: ExtensionVaultDownloads
}

/**
 * Resolve the builder's vault input (`NOOK_EXTENSION_VAULT`): a known target
 * name or an absolute Simple vault URL. Companion WASM owns the names, the
 * default, and URL validation; an unknown name throws its diagnostic.
 * Callers acquire companion WASM readiness first.
 */
export function resolveExtensionVaultTarget(
  input: string,
): ExtensionVaultTarget {
  const defaultName = default_simple_vault_target_name()
  // Docker build arguments and Task pass-through turn an unset variable into
  // an empty string, so an empty value selects the default target too.
  const requested = input.trim() || defaultName
  const simpleVaultBaseUrl = resolve_simple_vault_target(requested)
  if (requested === defaultName || URL.canParse(requested)) {
    return {
      simpleVaultBaseUrl,
      downloads: { kind: ExtensionVaultDownloadsKind.Default },
    }
  }
  return {
    simpleVaultBaseUrl,
    downloads: { kind: ExtensionVaultDownloadsKind.Named, name: requested },
  }
}

/** The vault target this process builds, packages, or verifies. */
export function extensionVaultTargetFromEnvironment(): ExtensionVaultTarget {
  return resolveExtensionVaultTarget(process.env.NOOK_EXTENSION_VAULT || '')
}

/** File-name suffix that keeps a named target's downloads beside the default's. */
export function extensionDownloadNameSuffix(
  target: ExtensionVaultTarget,
): string {
  switch (target.downloads.kind) {
    case ExtensionVaultDownloadsKind.Default:
      return ''
    case ExtensionVaultDownloadsKind.Named:
      return `-${target.downloads.name}`
  }
}

/** Deployment metadata file name under the site's `downloads/` path. */
export function extensionMetadataFileName(
  target: ExtensionVaultTarget,
): string {
  return `extension${extensionDownloadNameSuffix(target)}.json`
}
