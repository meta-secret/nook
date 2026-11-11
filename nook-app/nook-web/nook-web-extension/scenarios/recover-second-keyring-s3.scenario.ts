import { expect, test, type Page } from '@playwright/test'
import { LocalS3Identity } from '../scripts/local-s3'
import {
  connectS3InFirstRun,
  connectS3OnRecoveryScreen,
  createKeyringOnS3,
  ManagePage,
  nameFirstIdentityHere,
  openIdentitiesPage,
  openManagePage,
  openStoreId,
  openVaultPage,
  uniqueS3KeyPrefix,
  type E2eS3Location,
} from '../../nook-web-app/e2e/helpers'
import { MOCK_AUTH_DEFAULT_PIN } from '../e2e/mock-auth/accounts'
import { firstPage } from './dev-browser'
import {
  protectWithPin,
  runScenario,
  saveLogin,
  startVaultWithPin,
} from './steps'

/** The keyring card the recovery screen lists for the kept vault. */
function listedKeyring(page: Page, storeId: string) {
  return page.locator(
    `[data-testid="provider-identity"][data-store-ids~="${storeId}"]`,
  )
}

/** Run one of a listed keyring's ways in. */
async function applyDecision(
  page: Page,
  storeId: string,
  decision: string,
): Promise<void> {
  await listedKeyring(page, storeId)
    .locator(
      `[data-testid="provider-identity-decision"][data-decision="${decision}"]`,
    )
    .click()
}

/** From the keyrings page, Recover keyring on the S3 location. */
async function recoverFromS3(
  page: Page,
  location: E2eS3Location,
): Promise<void> {
  // With no vault open, the keyrings page is already the page.
  if (!(await page.getByTestId('identities-hub').isVisible()))
    await openIdentitiesPage(page)
  await page.getByTestId('identity-recover').click()
  await connectS3OnRecoveryScreen(page, location)
}

/** Reopen the app and unlock this browser's own keyring with its PIN. */
async function reopenAndUnlock(page: Page): Promise<void> {
  await page.goto('/app/')
  const pin = page.getByTestId('card-pin-input')
  const unlock = page.getByTestId('identity-unlock').first()
  await expect(pin.or(unlock).first()).toBeVisible()
  if (!(await pin.isVisible())) await unlock.click()
  await pin.fill(MOCK_AUTH_DEFAULT_PIN)
  await page.getByTestId('card-pin-submit').click()
  await expect(pin).toHaveCount(0)
}

// Two devices. The first keeps a PIN-protected keyring on the local S3
// server with one vault and a login. The second already has a keyring of its
// own, with a vault open, and brings the first device's keyring in with
// Recover keyring: it asks to join, is approved, and finishes joining. That
// keyring's vault is not on this browser; Open vault on its card reads it
// from S3 and goes into it, and stays there.
test('a browser with its own keyring recovers a second keyring and opens its vault', async () => {
  await runScenario(async (devices) => {
    const location: E2eS3Location = {
      keyPrefix: uniqueS3KeyPrefix('recover-second'),
      identity: LocalS3Identity.DeviceA,
    }
    const joinerLocation: E2eS3Location = {
      keyPrefix: location.keyPrefix,
      identity: LocalS3Identity.DeviceB,
    }
    const first = await devices.open('first-device')
    const vault = await firstPage(first)
    let storeId = ''
    await devices.step('first device: S3 keyring with a login', async () => {
      await startVaultWithPin(first)
      await connectS3InFirstRun(vault, location)
      await createKeyringOnS3(vault, 'S3 keyring')
      await openVaultPage(vault)
      await saveLogin(vault)
      storeId = await openStoreId(vault)
    })

    const second = await devices.open('second-device')
    const joiner = await firstPage(second)
    await devices.step(
      'second device: its own keyring with a vault open',
      async () => {
        await startVaultWithPin(second)
        await nameFirstIdentityHere(joiner, 'Own keyring')
        await openVaultPage(joiner)
        await saveLogin(joiner)
      },
    )
    await devices.step(
      'second device: Recover keyring asks to join the S3 keyring',
      async () => {
        await recoverFromS3(joiner, joinerLocation)
        await expect(listedKeyring(joiner, storeId)).toBeVisible()
        await applyDecision(joiner, storeId, 'askToJoin')
        // Asking needs this browser's device key: its PIN unlocks it.
        const prepare = joiner.getByRole('dialog', {
          name: 'Prepare this browser',
        })
        await prepare.getByRole('textbox').fill(MOCK_AUTH_DEFAULT_PIN)
        await prepare.getByRole('button', { name: /^Continue/ }).click()
        // Each keyring has its own key: a PIN key for the joined one.
        await protectWithPin(joiner)
        // The key ceremony returns to the provider choice: connect again.
        await connectS3OnRecoveryScreen(joiner, joinerLocation)
        await expect(listedKeyring(joiner, storeId)).toHaveAttribute(
          'data-standing',
          'joinRequested',
        )
      },
    )
    await devices.step('first device: approves the join', async () => {
      await openManagePage(vault, ManagePage.Devices)
      await vault.getByTestId('identity-sync-now-btn').click()
      const request = vault.getByTestId('identity-join-request')
      await expect(request).toBeVisible()
      await request.getByTestId('identity-join-request-approve').click()
      await expect(request).toHaveCount(0)
    })
    await devices.step(
      'second device: finishes joining from Recover keyring',
      async () => {
        await reopenAndUnlock(joiner)
        await recoverFromS3(joiner, joinerLocation)
        await expect(listedKeyring(joiner, storeId)).toHaveAttribute(
          'data-standing',
          'joinApproved',
        )
        await applyDecision(joiner, storeId, 'finishJoining')
        await expect(joiner.getByTestId('remote-vault-choice')).toHaveCount(0)
      },
    )
    await devices.step(
      'second device: opens the recovered keyring vault and stays in it',
      async () => {
        const away = joiner.locator(
          `[data-testid="identity-vault-row"][data-store-id="${storeId}"]`,
        )
        await expect(away).toHaveAttribute('data-state', 'unavailable')
        await away.click()
        await joiner.getByTestId('vault-panel-open').click()
        await expect(joiner.getByTestId('vault-panel')).toBeVisible()
        await expect(joiner).toHaveURL(/\/vault$/)
        // Background work after the open (the next sync, the extension
        // following the session) must not send it back to the keyrings.
        await joiner.waitForTimeout(12_000)
        await expect(joiner).toHaveURL(/\/vault$/)
        await expect(
          joiner
            .getByTestId('vault-group-login')
            .getByTestId('secret-row')
            .first(),
        ).toBeVisible()
        expect(await openStoreId(joiner)).toBe(storeId)
      },
    )
  })
})
