// Print what a vault target's deployment package must contain, for shell
// verifiers: `bun scripts/vault-url.ts meta-secret`. The channel and public
// site come from NOOK_EXTENSION_CHANNEL and NOOK_EXTENSION_SITE_URL, as for
// packaging.
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { SimpleVaultTarget } from '../src/lib/simple-vault-target'
import {
  parseExtensionChannel,
  resolveExtensionChannel,
} from './channel-identity'
import {
  extensionInstallMethod,
  extensionPackageSiteUrl,
} from './deployment-package'
import {
  extensionPackageHost,
  resolveExtensionVaultTarget,
} from './vault-target'

await companionWasmReady

const target = resolveExtensionVaultTarget(process.argv[2] || '')
const channel = parseExtensionChannel(resolveExtensionChannel())
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
console.log(`package_host=${extensionPackageHost(target)}`)
console.log(`package_site=${extensionPackageSiteUrl(target, siteUrl).href}`)
