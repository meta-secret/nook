import { expect, test, type Page } from '@playwright/test'

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
    await test.step(
      'discover the extension-created passkey in the reopened local vault',
      this.discover.bind(this),
    )
  }

  private async discover(): Promise<void> {
    const row = this.page.locator('.item-row').filter({ hasText: 'Alice' })
    await expect(row).toBeVisible()
    await row.click()
    const details = this.page.locator('.detail-pane')
    await expect(details).toContainText('Alice')
    await expect(
      details.getByRole('button', { name: 'Show value', exact: true }),
    ).toHaveCount(0)
    await expect(
      details.getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveCount(0)
    await expect(
      details.getByRole('button', { name: 'Delete', exact: true }),
    ).toBeVisible()
  }
}
