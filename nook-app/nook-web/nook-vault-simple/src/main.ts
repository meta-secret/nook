import { VaultApplication } from "$app-wasm";
import { configureVaultExtensionConnectScopeRuntime } from "$vault-shared/extension-connect-runtime";
import { mountVaultApp } from "$vault-shared/main";

configureVaultExtensionConnectScopeRuntime();
await mountVaultApp(VaultApplication.Simple);

export default {};
