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
}
