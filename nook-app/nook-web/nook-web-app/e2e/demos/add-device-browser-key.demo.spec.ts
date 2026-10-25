import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  forceVaultQuiescentForE2e,
  openIdentitiesPage,
  openVaultPage,
  seedSyncProvidersWhileUnlocked,
} from '../helpers'

async function snapshot(page: Page, name: string) {
  const directory = process.env.NOOK_DEMO_SCREENSHOT_DIR
  if (!directory) return
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
}

/** The page as it runs on a paired extension's key that has not joined the
 * identity: the extension's offscreen session is not routable here, so its
 * key source and standing are set on the exposed vault. The identity is
 * not loaded again meanwhile, so the scenario holds until the switch. */
async function useUnjoinedExtensionKey(page: Page) {
  await page.evaluate(() => {
    const vault = window.__nookVault
    if (!vault) throw new Error('vault-unavailable')
    const view = vault.identityControl.view
    if (!('snapshot' in view)) throw new Error('identity-not-loaded')
    Reflect.set(vault.identityControl, 'followOpenVault', async () => ({
      isErr: () => false,
    }))
    // VaultIdentityKeySource.PairedCompanion
    vault.identityKeySource = 1
    vault.identityControl.view = {
      ...view,
      snapshot: { ...view.snapshot, standing: 'notListed' },
    }
  })
}

/** The identity follows the open vault again, as it does in the app. */
async function followIdentityAgain(page: Page) {
  await page.evaluate(() => {
    const vault = window.__nookVault
    if (!vault) throw new Error('vault-unavailable')
    Reflect.deleteProperty(vault.identityControl, 'followOpenVault')
  })
}

test("a page on the extension's key switches to this browser's passkey to add a device", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)
  await openVaultPage(page)
  await seedSyncProvidersWhileUnlocked(page)
  await forceVaultQuiescentForE2e(page)

  // A member with a cloud copy reaches the invite.
  await openIdentitiesPage(page)
  const protection = page.getByTestId('identity-protection-toggle')
  await expect(protection).toContainText('1 of 2 done', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await protection.click()
  await page.getByTestId('identity-protection-action').click()
  const stage = page.getByTestId('add-device-stage')
  await expect(stage).toHaveAttribute('data-stage', 'invite', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  // On the extension's key, which has not joined, the page says so instead
  // of showing nothing, and offers this browser's own passkey. Sync is held
  // so a reprojection of the identity does not replace the scenario.
  await forceVaultQuiescentForE2e(page)
  await expect(async () => {
    await useUnjoinedExtensionKey(page)
    await expect(stage).toHaveAttribute('data-stage', 'not-member', {
      timeout: 1_000,
    })
  }).toPass({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(page.getByTestId('add-device-not-member')).toContainText(
    "Nook is using the key your browser extension holds, and that key hasn't joined",
  )
  const useBrowserKey = page.getByTestId('add-device-use-browser-key')
  // What offers the switch: the extension's key in use, a passkey on this
  // browser, and the open vault to return to.
  const offer = await page.evaluate(() => {
    const vault = window.__nookVault
    if (!vault) throw new Error('vault-unavailable')
    return {
      keySource: vault.identityKeySource,
      lockedStatus: vault.deviceProtectionLockedStatus,
      activeVault: vault.activeVault.kind,
      stage: document
        .querySelector('[data-testid="add-device-stage"]')
        ?.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '')
        .slice(0, 1200),
    }
  })
  await expect(useBrowserKey, JSON.stringify(offer)).toBeVisible()
  await snapshot(page, '1-extension-key-not-member')

  // Only this page locks; this browser's passkey reopens the same vault and
  // the flow comes back at the invite.
  await followIdentityAgain(page)
  await useBrowserKey.click()
  await expect(page.getByTestId('add-device-stage')).toHaveAttribute(
    'data-stage',
    'invite',
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  await expect(page.getByTestId('add-device-use-browser-key')).toHaveCount(0)
  await snapshot(page, '2-browser-key-invite')
})
