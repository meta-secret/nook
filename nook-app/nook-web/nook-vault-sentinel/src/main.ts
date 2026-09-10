import { VaultApplication } from '$app-wasm'
import { vaultApplicationEntrypoint } from '$vault-shared/main'

await vaultApplicationEntrypoint.start(VaultApplication.Sentinel)

export default {}
