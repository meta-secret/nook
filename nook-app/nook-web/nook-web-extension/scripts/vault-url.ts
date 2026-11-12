// Print a vault target's Simple and Sentinel base URLs and its deployment
// metadata file name for shell verifiers: `bun scripts/vault-url.ts meta-secret`.
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { SimpleVaultTarget } from '../src/lib/simple-vault-target'
import {
  extensionMetadataFileName,
  resolveExtensionVaultTarget,
} from './vault-target'

await companionWasmReady

const target = resolveExtensionVaultTarget(process.argv[2] || '')
console.log(`simple=${target.simpleVaultBaseUrl}`)
console.log(
  `sentinel=${new SimpleVaultTarget(target.simpleVaultBaseUrl).sentinelBase}`,
)
console.log(`metadata=${extensionMetadataFileName(target)}`)
