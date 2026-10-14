import type { Page } from '@playwright/test'
import { installPasskeyMock } from './helpers'

/** A browser whose passkey prompts are answered by the e2e mock. */
export class ManualPasskeyScenario {
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
}
