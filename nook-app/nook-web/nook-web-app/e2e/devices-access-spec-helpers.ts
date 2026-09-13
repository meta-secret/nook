import type { Page } from '@playwright/test'
import { expect } from './fixtures'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, installPasskeyMock } from './helpers'

export class DevicesAccessSpec {
  static async prepare({ page }: { page: Page }): Promise<void> {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
  }

  static async openRelationshipGraph(page: Page): Promise<void> {
    const graphView = page.getByTestId('devices-access-layout-graph')
    await expect(graphView).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await graphView.click()
  }
}
