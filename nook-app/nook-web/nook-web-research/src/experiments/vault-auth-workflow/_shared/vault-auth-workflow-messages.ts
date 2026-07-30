export enum VaultAuthStepKey {
  ChooseSentinelInterface = 'choose_sentinel_interface',
  ChooseVaultKind = 'choose_vault_kind',
  ConfirmVaultIdentity = 'confirm_vault_identity',
  CreateLocally = 'create_locally',
  CreateOrConfigure = 'create_or_configure',
  InitializeDevice = 'initialize_device',
  NameVault = 'name_vault',
  UnlockExistingVault = 'unlock_existing_vault',
  UnlockWithPasskey = 'unlock_with_passkey',
}

enum VaultAuthLocale {
  English = 'en',
}

const VAULT_AUTH_STEP_CATALOG: Record<
  VaultAuthLocale,
  Record<VaultAuthStepKey, string>
> = {
  en: {
    choose_sentinel_interface: 'Choose Sentinel interface',
    choose_vault_kind: 'Choose Simple or Sentinel',
    confirm_vault_identity: 'Confirm vault identity',
    create_locally: 'Create locally',
    create_or_configure: 'Create or configure',
    initialize_device: 'Initialize this device (passkey)',
    name_vault: 'Name vault',
    unlock_existing_vault: 'Unlock existing vault',
    unlock_with_passkey: 'Unlock with passkey',
  },
}

export function vaultAuthStepMessage(
  key: VaultAuthStepKey,
  locale: VaultAuthLocale = VaultAuthLocale.English,
): string {
  return VAULT_AUTH_STEP_CATALOG[locale][key]
}
