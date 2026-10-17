import { expect, test, type Page } from '@playwright/test'
import { DeviceProtectionStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
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
  type SidePanelStubScenario,
} from './helpers/side-panel-stub-runtime'

// The panel's own behavior on a stubbed runtime: This site and its Fill
// outcomes, lists that follow the tab, failures with their retries, and
// state changed elsewhere. The service worker's routes have their own
// hermetic tests; this spec covers what the panel does with their answers.

const accountsSite: SidePanelSiteListing = {
  kind: SidePanelSiteListingKind.Ready,
  display_host: 'accounts.example.com',
  items: [
    {
      itemId: { vaultStoreId: 'store-personal', secretId: 'login-alice' },
      username: 'alice@example.com',
      vaultLabel: 'Personal',
    },
    {
      itemId: { vaultStoreId: 'store-personal', secretId: 'login-work' },
      username: 'alice@company.example',
      vaultLabel: 'Personal',
    },
  ],
}

const newsSite: SidePanelSiteListing = {
  kind: SidePanelSiteListingKind.Ready,
  display_host: 'news.example.org',
  items: [
    {
      itemId: { vaultStoreId: 'store-personal', secretId: 'login-news' },
      username: 'reader@example.com',
      vaultLabel: 'Personal',
    },
  ],
}

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
  expect(
    await page
      .getByTestId('side-panel-ceremony')
      .evaluate(
        (ceremony, reasonText) =>
          ceremony.nextElementSibling?.textContent?.trim() === reasonText,
        'Nook locked before filling. Unlock it, then fill again.',
      ),
  ).toBe(true)
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
  await expect(page.getByTestId('side-panel-login')).toHaveCount(1)

  await panel.update({ listing: accountsSite })
  await panel.navigateTab()
  await expect(page.getByTestId('side-panel-site-host')).toHaveText(
    'accounts.example.com',
  )
  expect(await panel.sent(SidePanelSiteMessageType.ListLogins)).toBe(listed + 2)

  // A click into the panel keeps the list under the pointer.
  await panel.focus()
  await expect(page.getByTestId('side-panel-login')).toHaveCount(2)
  expect(await panel.sent(SidePanelSiteMessageType.ListLogins)).toBe(listed + 2)
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
  await expect(page.getByTestId('side-panel-login')).toHaveCount(2)
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
  await panel.setVisibility('hidden')
  await panel.setVisibility('visible')
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
  expect(
    await error.evaluate(
      (element) =>
        element.parentElement?.nextElementSibling?.getAttribute(
          'data-testid',
        ) === 'device-protection-pin-unlock-btn',
    ),
  ).toBe(true)
})
