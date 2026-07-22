export type VaultAuthStepKey =
  | 'choose_sentinel_interface'
  | 'choose_vault_kind'
  | 'confirm_vault_identity'
  | 'create_locally'
  | 'create_or_configure'
  | 'initialize_device'
  | 'name_vault'
  | 'unlock_existing_vault'
  | 'unlock_with_passkey'

type VaultAuthLocale = 'en'

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
  locale: VaultAuthLocale = 'en',
): string {
  return VAULT_AUTH_STEP_CATALOG[locale][key]
}
