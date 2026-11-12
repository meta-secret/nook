// Print what a vault target's deployment package must contain, for shell
// verifiers: `bun scripts/vault-url.ts meta-secret`. The channel and public
// site come from NOOK_EXTENSION_CHANNEL and NOOK_EXTENSION_SITE_URL, as for
// packaging.
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { ExtensionPackageHost } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { SimpleVaultTarget } from '../src/lib/simple-vault-target'
import {
  parseExtensionChannel,
  resolveExtensionChannel,
} from './channel-identity'
import {
  extensionInstallMethod,
  extensionPackageSiteUrl,
} from './deployment-package'
import { resolvePublishedExtensionVaultTarget } from './vault-target'

/** The `package_host` value shell verifiers branch on. */
function packageHostLabel(packageHost: ExtensionPackageHost): string {
  switch (packageHost) {
    case ExtensionPackageHost.Site:
      return 'site'
    case ExtensionPackageHost.SimpleVault:
      return 'simple-vault'
  }
}

await companionWasmReady

const channel = parseExtensionChannel(resolveExtensionChannel())
const target = resolvePublishedExtensionVaultTarget(
  process.argv[2] || '',
  channel,
)
const siteUrl =
  process.env.NOOK_EXTENSION_SITE_URL?.trim() || 'https://nokey.sh/'
console.log(`simple=${target.simpleVaultBaseUrl}`)
console.log(
  `sentinel=${new SimpleVaultTarget(target.simpleVaultBaseUrl).sentinelBase}`,
)
console.log(`metadata=${target.metadataFileName}`)
console.log(
  `install_method=${extensionInstallMethod(channel, target.distribution)}`,
)
console.log(`package_host=${packageHostLabel(target.packageHost)}`)
console.log(`package_site=${extensionPackageSiteUrl(target, siteUrl).href}`)
