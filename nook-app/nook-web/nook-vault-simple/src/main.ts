import { VaultApplication } from "$app-wasm";
import { configureVaultExtensionConnectScopeRuntime } from "$vault-shared/extension-connect-runtime";
import { vaultApplicationEntrypoint } from "$vault-shared/main";

configureVaultExtensionConnectScopeRuntime();
await vaultApplicationEntrypoint.start(VaultApplication.Simple);

export default {};
