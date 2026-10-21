import { expect, test, type Page } from '@playwright/test'
import type { VaultState } from '../../../nook-web-shared/src/vault-app/lib/vault.svelte'

export enum WebsitePasskeyStateKind {
  NotCreated = 'not-created',
  Created = 'created',
}
export type WebsitePasskeyState =
  | { kind: WebsitePasskeyStateKind.NotCreated }
  | { kind: WebsitePasskeyStateKind.Created; credentialId: string }

/** Owns discovery assertions for the reopened vault page. */
export class PasskeyVaultDiscovery {
  constructor(private readonly page: Page) {}

  async assert(state: WebsitePasskeyState): Promise<void> {
    switch (state.kind) {
      case WebsitePasskeyStateKind.NotCreated:
        return
      case WebsitePasskeyStateKind.Created:
        break
    }
    await this.captureNativeFailures(true)
    try {
      await test.step(
        'discover the extension-created passkey in the reopened local vault',
        this.discover.bind(this),
      )
    } finally {
      await this.captureNativeFailures(false)
    }
  }

  private async discover(): Promise<void> {
    const passkeyGroup = this.page.getByTestId('vault-group-passkey')
    await expect(passkeyGroup).toBeVisible()
    await expect(passkeyGroup).toContainText('Alice')
    const siteGroup: Parameters<ReturnType<Page['getByTestId']>['filter']>[0] =
      { has: passkeyGroup }
    await expect(
      this.page.getByTestId('vault-site-group').filter(siteGroup),
    ).toContainText('localhost')
    await passkeyGroup.getByTestId('secret-row-toggle').click()
    await expect(passkeyGroup).toContainText('alice@example.com')
    await expect(passkeyGroup.getByTestId('reveal-secret-btn')).toHaveCount(0)
    await expect(passkeyGroup.getByTestId('edit-secret-btn')).toHaveCount(0)
    await expect(passkeyGroup.getByTestId('delete-secret-btn')).toBeVisible()
  }

  private async captureNativeFailures(enabled: boolean): Promise<void> {
    const result = await this.page.evaluate((shouldCapture) => {
      const vault = (
        window as Window & { __nookVault?: Pick<VaultState, 'admitManager'> }
      ).__nookVault
      if (!vault) return 'Vault runtime is not exposed'
      const admission = vault.admitManager()
      if (admission.isErr()) return admission.error.translationKey
      const manager = admission.value
      if (!shouldCapture) {
        Reflect.deleteProperty(manager, 'passkey_details_js')
        return ''
      }
      const original = manager.passkey_details_js
      manager.passkey_details_js = function (...args) {
        try {
          return original.apply(this, args)
        } catch (nativeFailure) {
          const message =
            nativeFailure instanceof Error
              ? nativeFailure.message
              : typeof nativeFailure === 'string'
                ? nativeFailure
                : ''
          let category = 'unknown-redacted'
          if (message === 'Encryption failed: Vault crypto not initialized.') {
            category = 'crypto-admission'
          } else if (/^Secret .+ not found\.$/.test(message)) {
            category = 'record-missing'
          } else if (
            message.startsWith('Decryption setup error:') ||
            message.startsWith('Decryption error:') ||
            message.startsWith('Read error:')
          ) {
            category = 'record-decrypt'
          } else if (message === 'Invalid passkey YAML payload') {
            category = 'record-parse'
          } else if (
            message ===
            'Invalid passkey payload: public key is not canonical base64url'
          ) {
            category = 'public-key-projection'
          } else if (
            message ===
            'Invalid passkey payload: backup state requires backup eligibility'
          ) {
            category = 'backup-projection'
          } else if (message === 'errors.validation.age_armored_invalid') {
            category = 'ciphertext-format'
          } else if (message.startsWith('Invalid passkey payload:')) {
            category = 'record-validation'
          } else if (
            message ===
            'Database error: Requested secret is not a passkey item.'
          ) {
            category = 'record-kind'
          } else if (
            message.startsWith(
              'recursive use of an object detected which would lead to',
            )
          ) {
            category = 'binding-borrow'
          }
          // Emit only a fixed category through the existing E2E console capture.
          console.error(`[passkey-details native category] ${category}`)
          throw nativeFailure
        }
      }
      return ''
    }, enabled)
    expect(result).toBe('')
  }
}
