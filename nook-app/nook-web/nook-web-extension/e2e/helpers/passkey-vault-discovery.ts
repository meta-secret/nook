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
      await this.waitForAssertedRevision(state.credentialId)
      await test.step(
        'discover the extension-created passkey in the reopened local vault',
        this.discover.bind(this),
      )
    } finally {
      await this.captureNativeFailures(false)
    }
  }

  private async waitForAssertedRevision(credentialId: string): Promise<void> {
    let currentRecordId = ''
    await expect
      .poll(async () => {
        currentRecordId = await this.page.evaluate(
          async (expectedCredentialId) => {
            const vault = (
              window as Window & {
                __nookVault?: Pick<
                  VaultState,
                  'admitManager' | 'enqueueStorage' | 'secrets'
                >
              }
            ).__nookVault
            if (!vault) throw new Error('Vault runtime is not exposed')
            const result = await vault.enqueueStorage(async () => {
              const admission = vault.admitManager()
              if (admission.isErr())
                throw new Error('Vault manager is unavailable')
              const selected = vault.secrets.find(
                (item) => item.typeName === 'passkey',
              )
              if (!selected) return admission.map(() => '')
              const details = await admission.value.passkey_details_js(
                selected.id,
              )
              try {
                return admission.map(() =>
                  details.credentialId === expectedCredentialId &&
                  details.signatureCount === 1
                    ? details.currentRecordId
                    : '',
                )
              } finally {
                details.free()
              }
            })
            if (result.isErr()) throw new Error('Passkey revision read failed')
            return result.value
          },
          credentialId,
        )
        return currentRecordId !== ''
      })
      .toBe(true)

    // A fresh detail read can resolve an old list ID. Wait for the actual
    // companion import to publish the signed replacement before selecting it.
    await expect
      .poll(() =>
        this.page.evaluate((expectedRecordId) => {
          const vault = (
            window as Window & { __nookVault?: Pick<VaultState, 'secrets'> }
          ).__nookVault
          if (!vault) throw new Error('Vault runtime is not exposed')
          return vault.secrets.some((item) => item.id === expectedRecordId)
        }, currentRecordId),
      )
      .toBe(true)
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
      manager.passkey_details_js = async function (...args) {
        try {
          return await original.apply(this, args)
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
