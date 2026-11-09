import { expect, test, type Page } from '@playwright/test'
import { LocalS3Identity } from '../scripts/local-s3'
import {
  connectS3InFirstRun,
  connectS3OnRecoveryScreen,
  createKeyringOnS3,
  ManagePage,
  openManagePage,
  openStoreId,
  openVaultAfterIdentityJoin,
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

/** Pick one of a listed keyring's ways in and apply it. */
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
  await page.getByTestId('remote-vault-choice-apply').click()
}

/** On a fresh browser's first screen, recover from a sync provider: the
 * same S3 location lists the keyring that keeps the vault, with its ways
 * in, and no vault opens on its own. */
async function listKeyringOnRecoveryScreen(
  page: Page,
  location: E2eS3Location,
  storeId: string,
): Promise<void> {
  await page.getByTestId('login-connect-storage-btn').click()
  await connectS3OnRecoveryScreen(page, location)
  await expect(page.getByTestId('remote-vault-choice')).toBeVisible()
  await expect(page.getByTestId('provider-identity')).toHaveCount(1)
  const card = listedKeyring(page, storeId)
  await expect(card).toBeVisible()
  await expect(
    card.locator(
      '[data-testid="provider-identity-decision"][data-decision="askToJoin"]',
    ),
  ).toBeVisible()
  await expect(page.getByTestId('vault-panel')).toHaveCount(0)
  await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
}

// Two devices. The first keeps a PIN-protected keyring on the local S3
// server with one vault and a login. The second, a fresh profile, recovers
// from a sync provider on first run: the same S3 location lists the
// keyring, not the vault, and no vault opens on its own. Passkeys are not
// available here, so it asks to join with a PIN key; the first device
// approves, the second lists the keyring again, finishes joining, and lands
// on the keyrings page with that keyring, whose vault opens from its card.
test('a fresh device recovers an S3 keyring by asking to join it', async () => {
  await runScenario(async (devices) => {
    const location: E2eS3Location = {
      keyPrefix: uniqueS3KeyPrefix('recover-keyring'),
      identity: LocalS3Identity.DeviceA,
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
    const joinerLocation: E2eS3Location = {
      keyPrefix: location.keyPrefix,
      identity: LocalS3Identity.DeviceB,
    }
    await devices.step(
      'second device: recovery lists the keyring',
      async () => {
        await joiner.goto('/app/')
        await listKeyringOnRecoveryScreen(joiner, joinerLocation, storeId)
      },
    )
    await devices.step(
      'second device: asks to join with a PIN key',
      async () => {
        await applyDecision(joiner, storeId, 'askToJoin')
        await protectWithPin(joiner)
        await expect(
          listedKeyring(joiner, storeId).getByTestId(
            'provider-identity-standing',
          ),
        ).toBeVisible()
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
      'second device: finishes joining and opens the vault from its card',
      async () => {
        await joiner.goto('/app/')
        // The device's own fresh key is unlocked with its PIN, then the
        // keyring is recovered from the same provider again.
        const pin = joiner.getByTestId('card-pin-input')
        const unlock = joiner.getByTestId('identity-unlock').first()
        await expect(pin.or(unlock).first()).toBeVisible()
        if (!(await pin.isVisible())) await unlock.click()
        await pin.fill(MOCK_AUTH_DEFAULT_PIN)
        await joiner.getByTestId('card-pin-submit').click()
        await expect(pin).toHaveCount(0)
        await joiner.getByTestId('identity-recover').click()
        await connectS3OnRecoveryScreen(joiner, joinerLocation)
        await expect(listedKeyring(joiner, storeId)).toHaveAttribute(
          'data-standing',
          'joinApproved',
        )
        await applyDecision(joiner, storeId, 'finishJoining')
        await expect(joiner.getByTestId('remote-vault-choice')).toHaveCount(0)
        await expect(
          joiner.locator(
            `[data-testid="identity-vault-row"][data-store-id="${storeId}"]`,
          ),
        ).toBeVisible()
        await expect(joiner.getByTestId('vault-panel')).toHaveCount(0)
        await openVaultAfterIdentityJoin(joiner)
        await expect(
          joiner
            .getByTestId('vault-group-login')
            .getByTestId('secret-row')
            .first(),
        ).toBeVisible()
      },
    )
  })
})
