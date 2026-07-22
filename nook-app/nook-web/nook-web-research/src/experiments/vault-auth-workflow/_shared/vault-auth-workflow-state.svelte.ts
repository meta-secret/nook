import type { VaultAuthStepKey } from './vault-auth-workflow-messages'

export type Presence = 'empty' | 'existing'
export type VaultPath = 'undecided' | 'simple' | 'sentinel'

export class VaultAuthWorkflowState {
  presence = $state<Presence>('empty')
  step = $state(0)
  path = $state<VaultPath>('undecided')

  get steps(): VaultAuthStepKey[] {
    if (this.presence === 'existing') {
      return [
        'unlock_existing_vault',
        'confirm_vault_identity',
        'unlock_with_passkey',
      ]
    }
    if (this.path === 'simple') {
      return ['name_vault', 'choose_vault_kind', 'create_locally']
    }
    if (this.path === 'sentinel') {
      return [
        'name_vault',
        'choose_vault_kind',
        'choose_sentinel_interface',
        'initialize_device',
      ]
    }
    return ['name_vault', 'choose_vault_kind', 'create_or_configure']
  }

  setPresence(next: Presence): void {
    this.presence = next
    this.step = 0
    this.path = 'undecided'
  }

  continueAfterName(vaultName: string): void {
    if (vaultName.trim()) this.step = 1
  }

  choose(path: Exclude<VaultPath, 'undecided'>): void {
    this.path = path
    this.step = 2
  }

  goBack(): void {
    if (this.presence === 'empty' && this.step === 1) {
      this.path = 'undecided'
      this.step = 0
      return
    }
    if (this.presence === 'empty' && this.step === 2) {
      this.path = 'undecided'
      this.step = 1
      return
    }
    if (this.step > 0) this.step -= 1
  }
}
