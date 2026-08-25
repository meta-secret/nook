export enum SettingsSection {
  DevicesAccess = "devices-access",
  Storage = "storage",
  Onboard = "onboard",
  Admin = "admin",
}

export enum SettingsAccordionSection {
  Closed = "closed",
  Devices = "devices",
  Language = "language",
  Danger = "danger",
}

export enum AdminAccordionSection {
  Closed = "closed",
  Vaults = "vaults",
  Storage = "storage",
  Passwords = "passwords",
  ImportExport = "import-export",
}

export class VaultUiState {
  settingsOpen = $state(false);
  settingsSection = $state<SettingsSection>(SettingsSection.Storage);
  /** Survives the authenticated-to-login shell remount during identity switch. */
  devicesAccessIdentityProtectionOpen = $state(false);
  settingsAccordionSection = $state<SettingsAccordionSection>(
    SettingsAccordionSection.Devices,
  );
  adminAccordionSection = $state<AdminAccordionSection>(
    AdminAccordionSection.Vaults,
  );
  helpOpen = $state(false);
}
