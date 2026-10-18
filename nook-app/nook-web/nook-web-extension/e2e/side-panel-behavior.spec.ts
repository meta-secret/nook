import { expect, test, type Page } from '@playwright/test'
import { DeviceProtectionStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { SiteSecretRow } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import {
  SidePanelCodeFillKind,
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  SidePanelSiteMessageType,
  type SidePanelSiteListing,
} from '../src/lib/side-panel-site'
import { PairedVaultsMessageType } from '../src/lib/paired-vaults'
import {
  SidePanelStubAnswer,
  SidePanelStubFillDelivery,
  SidePanelStubPage,
  SidePanelStubVaults,
  SidePanelStubVisibility,
  type SidePanelStubScenario,
} from './helpers/side-panel-stub-runtime'

// The panel's own behavior on a stubbed runtime: This site and its Fill
// outcomes, lists that follow the tab, failures with their retries, and
// state changed elsewhere. The service worker's routes have their own
// hermetic tests; this spec covers what the panel does with their answers.

/** This-site rows and listings as the worker forwards Rust's presentation. */
class SiteRows {
  static login(secretId: string, account: string): SiteSecretRow {
    return {
      kind: 'Login',
      item_id: { vault_store_id: 'store-personal', secret_id: secretId },
      type_label_key: I18N_KEYS.VaultTypesLogin,
      title: 'accounts.example.com',
      account,
      saved_host: 'accounts.example.com',
      vault: { kind: 'Named', name: 'Personal' },
      action: {
        kind: 'FillLogin',
        label_key: I18N_KEYS.ExtensionActionFill,
        accessible_label_key: I18N_KEYS.ExtensionActionFillLogin,
      },
    }
  }

  static authenticator(): SiteSecretRow {
    return {
      kind: 'Authenticator',
      item_id: { vault_store_id: 'store-work', secret_id: 'totp-namecheap' },
      type_label_key: I18N_KEYS.VaultTypesAuthenticator,
      title: 'Namecheap',
      account: 'bynull',
      saved_host: 'www.namecheap.com',
      vault: { kind: 'Named', name: 'www' },
      action: {
        kind: 'FillCode',
        label_key: I18N_KEYS.ExtensionActionFillCode,
        accessible_label_key: I18N_KEYS.ExtensionActionFillCodeFor,
      },
    }
  }

  static passkey(): SiteSecretRow {
    return {
      kind: 'Passkey',
      item_id: { vault_store_id: 'store-work', secret_id: 'passkey-namecheap' },
      type_label_key: I18N_KEYS.VaultTypesPasskey,
      title: 'Namecheap',
      account: 'bynull',
      saved_host: 'www.namecheap.com',
      vault: { kind: 'Named', name: 'www' },
      action: { kind: 'ViewOnly' },
    }
  }

  static listing(host: string, rows: SiteSecretRow[]): SidePanelSiteListing {
    return {
      kind: SidePanelSiteListingKind.Ready,
      display_host: host,
      listing: {
        kind: 'Listed',
        groups: [{ header: { kind: 'Named', name: 'Alice Martin' }, rows }],
      },
    }
  }
}

const accountsSite = SiteRows.listing('accounts.example.com', [
  SiteRows.login('login-alice', 'alice@example.com'),
  SiteRows.login('login-work', 'alice@company.example'),
])

const newsSite = SiteRows.listing('news.example.org', [
  SiteRows.login('login-news', 'reader@example.com'),
])

const unlockedScenario: SidePanelStubScenario = {
  status: DeviceProtectionStatus.Unlocked,
  vaults: SidePanelStubVaults.Paired,
  listing: accountsSite,
  fill: { kind: SidePanelLoginFillKind.Filled },
}

async function openUnlocked(page: Page): Promise<SidePanelStubPage> {
  const panel = new SidePanelStubPage(page)
  await panel.open(unlockedScenario)
  await expect(page.getByTestId('side-panel-site-host')).toHaveText(
    'accounts.example.com',
  )
  return panel
}

function fillAlice(page: Page) {
  return page.getByRole('button', {
    name: 'Fill alice@example.com from Personal',
  })
}

test('shows each Fill outcome on its row and never submits', async ({
  page,
}) => {
  const panel = await openUnlocked(page)
  const result = page.getByTestId('side-panel-fill-result')

  await fillAlice(page).click()
  await expect(result).toHaveText('Filled. Review the page, then sign in.')

  await panel.update({ fill: { kind: SidePanelLoginFillKind.NoLoginForm } })
  await fillAlice(page).click()
  await expect(result).toHaveText(
    'No login form on this page. Open the sign-in form, then fill again.',
  )

  await panel.update({ fill: { kind: SidePanelLoginFillKind.FillFailed } })
  await fillAlice(page).click()
  await expect(result).toHaveText('Nook could not fill this login. Try again.')
  await expect(result).toHaveAttribute('role', 'alert')
})

test('a tab that moved on and a login that is gone say so and list again', async ({
  page,
}) => {
  const panel = await openUnlocked(page)
  const note = page.getByTestId('side-panel-site-note')

  await panel.update({
    fill: { kind: SidePanelLoginFillKind.TabChanged },
    listing: newsSite,
  })
  await fillAlice(page).click()
  await expect(note).toHaveText(
    'This tab moved to another site. Choose a login again.',
  )
  await expect(page.getByTestId('side-panel-site-host')).toHaveText(
    'news.example.org',
  )

  await panel.update({
    fill: { kind: SidePanelLoginFillKind.ItemNotFound },
    listing: accountsSite,
  })
  await page
    .getByRole('button', { name: 'Fill reader@example.com from Personal' })
    .click()
  await expect(note).toHaveText(
    'That login is no longer available for this site.',
  )
  await expect(page.getByTestId('side-panel-site-host')).toHaveText(
    'accounts.example.com',
  )
})

test('a Fill that finds Nook locked shows the locked view with the reason', async ({
  page,
}) => {
  const panel = await openUnlocked(page)
  await panel.update({
    fill: { kind: SidePanelLoginFillKind.Locked },
    status: DeviceProtectionStatus.Pin,
  })
  await fillAlice(page).click()
  await expect(page.getByTestId('side-panel-state')).toHaveText('Locked')
  const reason = page.getByTestId('side-panel-lock-reason')
  await expect(reason).toHaveText(
    'Nook locked before filling. Unlock it, then fill again.',
  )
  // Icon, heading, description, Unlock, then the reason.
  await expect(
    page
      .getByTestId('side-panel-ceremony')
      .locator('xpath=following-sibling::*[1]'),
  ).toHaveAttribute('data-testid', 'side-panel-lock-reason')
})

test('a locked Fill answer stays visible when the session reads unlocked', async ({
  page,
}) => {
  const panel = await openUnlocked(page)
  await panel.update({ fill: { kind: SidePanelLoginFillKind.Locked } })
  await fillAlice(page).click()
  await expect(page.getByTestId('side-panel-fill-result')).toHaveText(
    'Nook locked before filling. Unlock it, then fill again.',
  )
  await expect(page.getByTestId('side-panel-state')).toHaveText('Unlocked')
})

test('drops a late Fill answer after a tab switch and allows one Fill at a time', async ({
  page,
}) => {
  const panel = await openUnlocked(page)
  await panel.update({ fillDelivery: SidePanelStubFillDelivery.Held })
  await fillAlice(page).click()
  await expect(page.getByTestId('side-panel-fill-result')).toHaveText(
    'Filling…',
  )
  const fills = page.getByTestId('side-panel-fill')
  await expect(fills.nth(1)).toHaveAttribute('aria-disabled', 'true')

  await panel.update({ listing: newsSite })
  await panel.activateTab()
  await expect(page.getByTestId('side-panel-site-host')).toHaveText(
    'news.example.org',
  )
  // The request is still on its way, so the new list waits for it.
  await expect(fills.first()).toHaveAttribute('aria-disabled', 'true')
  expect(await panel.sent(SidePanelSiteMessageType.FillLogin)).toBe(1)

  await panel.releaseFills()
  await expect(fills.first()).toHaveAttribute('aria-disabled', 'false')
  await expect(page.getByTestId('side-panel-fill-result')).toHaveCount(0)
})

test('a tab switch or a new address drops the list and lists the tab again', async ({
  page,
}) => {
  const panel = await openUnlocked(page)
  const listed = await panel.sent(SidePanelSiteMessageType.ListLogins)

  await panel.update({ listing: newsSite })
  await panel.activateTab()
  await expect(page.getByTestId('side-panel-site-host')).toHaveText(
    'news.example.org',
  )
  await expect(page.getByTestId('side-panel-item')).toHaveCount(1)

  await panel.update({ listing: accountsSite })
  await panel.navigateTab()
  await expect(page.getByTestId('side-panel-site-host')).toHaveText(
    'accounts.example.com',
  )
  expect(await panel.sent(SidePanelSiteMessageType.ListLogins)).toBe(listed + 2)

  // A click into the panel keeps the list under the pointer.
  await panel.focus()
  await expect(page.getByTestId('side-panel-item')).toHaveCount(2)
  expect(await panel.sent(SidePanelSiteMessageType.ListLogins)).toBe(listed + 2)
})

test('typed rows sit under identity headers; authenticators Fill code and the rest view only', async ({
  page,
}) => {
  const panel = new SidePanelStubPage(page)
  await panel.open({
    ...unlockedScenario,
    listing: SiteRows.listing('www.namecheap.com', [
      SiteRows.authenticator(),
      SiteRows.passkey(),
    ]),
  })
  await expect(page.getByTestId('side-panel-site-group')).toHaveText(
    'Alice Martin',
  )
  const rows = page.getByTestId('side-panel-item')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).getByTestId('side-panel-item-type')).toHaveText(
    'Authenticator · www',
  )
  await expect(rows.nth(0).getByTestId('side-panel-item-subtitle')).toHaveText(
    'bynull · www.namecheap.com',
  )
  await expect(rows.nth(1).getByTestId('side-panel-item-type')).toHaveText(
    'Passkey · www',
  )
  // Passkeys and API keys are shown for reference only.
  await expect(rows.nth(1).getByTestId('side-panel-fill')).toHaveCount(0)

  const fillCode = page.getByRole('button', {
    name: 'Fill a 2FA code for bynull from www',
  })
  await expect(fillCode).toHaveText('Fill code')
  const result = page.getByTestId('side-panel-fill-result')
  await fillCode.click()
  await expect(result).toHaveText(
    'Code filled. Review the page, then continue.',
  )
  await panel.update({ codeFill: { kind: SidePanelCodeFillKind.NoCodeField } })
  await fillCode.click()
  await expect(result).toHaveText(
    'No 2FA code field on this page. Open the code step, then fill again.',
  )
  expect(await panel.sent(SidePanelSiteMessageType.FillCode)).toBe(2)
})

test("a page that needs only 2FA codes shows Rust's typed empty state", async ({
  page,
}) => {
  const panel = new SidePanelStubPage(page)
  await panel.open({
    ...unlockedScenario,
    listing: {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.namecheap.com',
      listing: {
        kind: 'Empty',
        message_key: I18N_KEYS.ExtensionActionSiteEmptyTotp,
        hint: { kind: 'Absent' },
      },
    },
  })
  const empty = page.getByTestId('side-panel-site-empty')
  await expect(empty).toHaveText('No 2FA codes saved for www.namecheap.com.')
  await expect(page.getByTestId('side-panel-item')).toHaveCount(0)
})

test('a failed listing offers Try again', async ({ page }) => {
  const panel = new SidePanelStubPage(page)
  const failed: SidePanelSiteListing = {
    kind: SidePanelSiteListingKind.ListFailed,
  }
  await panel.open({ ...unlockedScenario, listing: failed })
  await expect(page.getByTestId('side-panel-site-failed')).toHaveText(
    'Nook could not load logins for this site.',
  )
  await panel.update({ listing: accountsSite })
  await page.getByTestId('side-panel-site-retry').click()
  await expect(page.getByTestId('side-panel-item')).toHaveCount(2)
})

test('vaults that do not fill passwords say so and the panel re-reads them', async ({
  page,
}) => {
  const panel = new SidePanelStubPage(page)
  const unpaired: SidePanelSiteListing = {
    kind: SidePanelSiteListingKind.Unpaired,
  }
  await panel.open({ ...unlockedScenario, listing: unpaired })
  await expect(page.getByTestId('side-panel-site-no-filling')).toHaveText(
    'None of your connected vaults fills passwords yet.',
  )
  await expect
    .poll(() => panel.sent(PairedVaultsMessageType.Query))
    .toBeGreaterThan(1)
  await expect(page.getByTestId('side-panel-identities')).toBeVisible()
})

test('an unreadable vault list offers Try again', async ({ page }) => {
  const panel = new SidePanelStubPage(page)
  await panel.open({
    ...unlockedScenario,
    vaults: SidePanelStubVaults.Unavailable,
  })
  await expect(
    page.getByText('Nook could not load your identities.'),
  ).toBeVisible()
  await panel.update({ vaults: SidePanelStubVaults.Paired })
  await page.getByTestId('side-panel-retry-identities').click()
  await expect(page.getByTestId('side-panel-identities')).toBeVisible()
})

test('Open vault and Lock failures show a page alert', async ({ page }) => {
  const panel = await openUnlocked(page)
  const alert = page.getByTestId('side-panel-alert')

  await panel.update({ openVault: SidePanelStubAnswer.Refuse })
  await page.getByTestId('side-panel-open-vault').click()
  await expect(alert).toHaveText('Nook could not open that. Try again.')

  await panel.update({ lock: SidePanelStubAnswer.Refuse })
  await page.getByTestId('side-panel-lock').click()
  await expect(alert).toHaveText('Nook could not lock. Try again.')
  await expect(page.getByTestId('side-panel-state')).toHaveText('Unlocked')
  await expect(page.getByTestId('side-panel-lock')).toBeFocused()
})

test('a lock made elsewhere is picked up when the panel takes focus', async ({
  page,
}) => {
  const panel = await openUnlocked(page)
  await panel.update({ status: DeviceProtectionStatus.Pin })
  await panel.focus()
  await expect(page.getByTestId('side-panel-state')).toHaveText('Locked')
  await expect(
    page.getByTestId('device-protection-pin-unlock-input'),
  ).toBeFocused()
  await expect(page.getByTestId('side-panel-site')).toHaveCount(0)
})

test('a PIN lives only for its try and never survives a hidden panel', async ({
  page,
}) => {
  const panel = new SidePanelStubPage(page)
  await panel.open({ ...unlockedScenario, status: DeviceProtectionStatus.Pin })
  const pin = page.getByTestId('device-protection-pin-unlock-input')
  await expect(pin).toBeFocused()

  await pin.fill('123456')
  await panel.setVisibility(SidePanelStubVisibility.Hidden)
  await panel.setVisibility(SidePanelStubVisibility.Visible)
  await expect(pin).toHaveValue('')

  await panel.update({ pinUnlock: SidePanelStubAnswer.Refuse })
  await pin.fill('000000')
  await pin.press('Enter')
  const error = page.getByTestId('device-protection-error')
  await expect(error).toHaveText(
    'The PIN or passphrase did not unlock this browser. Check it and try again.',
  )
  await expect(pin).toHaveValue('')
  await expect(pin).toBeFocused()
  await expect(pin).toHaveAttribute('aria-invalid', 'true')
  // The message sits by the field, above the button.
  await expect(
    error.locator('xpath=parent::*/following-sibling::*[1]'),
  ).toHaveAttribute('data-testid', 'device-protection-pin-unlock-btn')
})
