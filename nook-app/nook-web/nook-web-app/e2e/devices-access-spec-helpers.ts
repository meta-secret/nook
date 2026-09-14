import type { Page } from '@playwright/test'
import { expect } from './fixtures'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, installPasskeyMock } from './helpers'

export class DevicesAccessScenario {
  private readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async prepare(): Promise<void> {
    await this.page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(this.page)
  }

  async openRelationshipGraph(): Promise<void> {
    const graphView = this.page.getByTestId('devices-access-layout-graph')
    await expect(graphView).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await graphView.click()
  }
}
