export type Presence = 'empty' | 'existing'
export type VaultPath = 'undecided' | 'simple' | 'sentinel'

export class VaultAuthWorkflowState {
  presence = $state<Presence>('empty')
  step = $state(0)
  path = $state<VaultPath>('undecided')

  get steps(): string[] {
    if (this.presence === 'existing') {
      return [
        'Unlock existing vault',
        'Confirm vault identity',
        'Unlock with passkey',
      ]
    }
    if (this.path === 'simple') {
      return ['Name vault', 'Choose Simple or Sentinel', 'Create locally']
    }
    if (this.path === 'sentinel') {
      return [
        'Name vault',
        'Choose Simple or Sentinel',
        'Choose Sentinel interface',
        'Initialize this device (passkey)',
      ]
    }
    return ['Name vault', 'Choose Simple or Sentinel', 'Create or configure']
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
