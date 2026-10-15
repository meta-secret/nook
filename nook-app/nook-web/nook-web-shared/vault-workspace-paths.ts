/** Workspace pages the app shell is served at, so a reload stays in the app. */
export const VAULT_WORKSPACE_OUTPUT_ALIASES = [
  "admin",
  "devices-access",
  "help",
  "identities",
  "identity",
  "identity/devices",
  "identity/devices/add",
  "identity/keys",
  "identity/passwords",
  "identity/settings",
  "identity/sync",
  "identity/vaults",
  "onboard",
  "settings",
  "vault",
  "vault/devices",
  "vault/import",
  "vault/passwords",
  "vault/sync",
] as const;

export const VAULT_WORKSPACE_SPA_PATHS = VAULT_WORKSPACE_OUTPUT_ALIASES.map(
  (alias) => `/${alias}`,
);
