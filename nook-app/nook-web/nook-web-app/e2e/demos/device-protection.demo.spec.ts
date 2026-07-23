import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expandSettingsSection,
  expectEmptyLocalFolderRejected,
  installPasskeyMock,
  openStorageSettings,
  waitForVaultOperationsIdle,
} from '../helpers'
import { installLocalFolderPickerMock } from '../local-folder-mock'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('offer PIN device protection when passkeys are unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
    localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
  })
  await page.goto('/app/')
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await demoBeat(page)

  await page.getByTestId('get-started-path-simple').click()
  await page.getByTestId('login-vault-name-input').fill('AI-debug PIN vault')
  await page.getByTestId('login-create-device-vault-btn').click()
  await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(
    page.getByTestId('device-protection-use-existing-choice'),
  ).toHaveText('Authenticate')
  await expect(page.getByTestId('device-protection-setup-btn')).toBeHidden()
  await expect(
    page.getByTestId('device-protection-create-new-choice'),
  ).toHaveText('Create passkey')
  await demoBeat(page)

  await page.getByTestId('device-protection-create-new-choice').click()
  await expect(page.getByTestId('device-protection-setup-btn')).toBeVisible()
  await demoBeat(page)

  await page.getByTestId('device-protection-setup-btn').click()
  await expect(page.getByTestId('device-protection-error')).toContainText(
    'Passkeys are unavailable in this browser profile',
  )
  await expect(
    page.getByTestId('device-protection-pin-setup-btn'),
  ).toBeVisible()
  await demoBeat(page)
})

test('reject an empty folder before existing-vault recovery', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')

    class EmptyDirectoryHandle {
      kind = 'directory' as const
      private directories = new Map<string, EmptyDirectoryHandle>()
      private files = new Map<string, string>()

      constructor(public name: string) {}

      async queryPermission() {
        return 'granted'
      }

      async requestPermission() {
        return 'granted'
      }

      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const existing = this.directories.get(name)
        if (existing) return existing
        if (!options?.create) {
          throw new DOMException('Not found', 'NotFoundError')
        }
        const child = new EmptyDirectoryHandle(name)
        this.directories.set(name, child)
        return child
      }

      async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!this.files.has(name) && !options?.create) {
          throw new DOMException('Not found', 'NotFoundError')
        }
        this.files.set(name, this.files.get(name) ?? '')
        const files = this.files
        return {
          kind: 'file' as const,
          name,
          getFile: async () => new File([files.get(name) ?? ''], name),
          createWritable: async () => ({
            write: async (data: string) => files.set(name, data),
            close: async () => undefined,
          }),
        }
      }

      async *entries() {
        for (const entry of this.directories.entries()) yield entry
      }
    }

    Object.assign(window, {
      showDirectoryPicker: async () => new EmptyDirectoryHandle('Nook Backup'),
    })
  })
  await page.goto('/app/')
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  await expectEmptyLocalFolderRejected(page, () => demoBeat(page))
  await demoBeat(page)
})

test('shows matching passkeys and password recovery before opening a folder backup', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await installPasskeyMock(page)
  await installLocalFolderPickerMock(page)
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)
  await openStorageSettings(page)
  await expandSettingsSection(page, 'unlock')
  await addVaultPassword(page, 'Emergency recovery', 'demo-backup-password')
  await expandSettingsSection(page, 'storage')
  await page.getByTestId('add-provider-btn').first().click()
  await page.getByTestId('provider-option-local-folder').click()
  await page.getByTestId('settings-choose-local-folder-btn').click()
  await page.getByTestId('settings-connect-local-folder-btn').click()
  await waitForVaultOperationsIdle(page)
  await assertVaultReady(page)

  await clearBrowserVault(page)
  await page.reload()
  await page.getByTestId('login-connect-storage-btn').click()
  await page.getByTestId('provider-option-local-folder').click()
  await page.getByTestId('login-choose-local-folder-btn').click()
  await page.getByTestId('login-connect-local-folder-btn').click()

  const summary = page.getByTestId('existing-vault-recovery-summary')
  await expect(summary).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(summary).toContainText('Passkeys for this vault')
  await expect(summary).toContainText('device ')
  await expect(summary).toContainText('Backup password available')
  await expect(summary).toContainText('Emergency recovery')
  await demoBeat(page)

  await page.getByTestId('device-protection-use-existing-choice').click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('local-folder-setup')).toHaveCount(0)
  await demoBeat(page)
})
