import { VaultApplication } from "$app-wasm";
import { mountVaultApp } from "$vault-shared/main";

await mountVaultApp(VaultApplication.Sentinel);

export default {};
