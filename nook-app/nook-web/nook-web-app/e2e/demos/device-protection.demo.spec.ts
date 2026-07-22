import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectEmptyLocalFolderRejected,
} from '../helpers'

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
