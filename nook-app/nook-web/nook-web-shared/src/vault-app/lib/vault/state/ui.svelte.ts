export type SettingsSection = "storage" | "onboard" | "admin";
export type SettingsAccordionSection = "devices" | "language" | "danger";
export type AdminAccordionSection =
  | "vaults"
  | "storage"
  | "passwords"
  | "import-export";

export class VaultUiState {
  settingsOpen = $state(false);
  settingsSection = $state<SettingsSection>("storage");
  settingsAccordionSection = $state<SettingsAccordionSection>("devices");
  adminAccordionSection = $state<AdminAccordionSection>("vaults");
  helpOpen = $state(false);
}
