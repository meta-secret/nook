import { expect, test } from '@playwright/test'
import enLocale from '../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }
import { LocalS3Identity } from '../scripts/local-s3'
import {
  PairedVaultsMessageType,
  type IdentityVaultsRefreshMessage,
} from '../src/lib/paired-vaults'
import {
  approveExtensionConnect,
  waitForExtensionPairingReady,
} from './helpers/extension-approval'
import {
  EXTENSION_UNLOCK_TIMEOUT_MS,
  installMockPasskeyRuntime,
  isHostedSmoke,
  launchExtensionContext,
  readExtensionStorage,
  reuseNookTabForConnect,
  setupPasskeyExtensionPopup,
  setupStorageKey,
  simpleVaultBaseUrl,
} from './helpers/extension-smoke-runtime'
import {
  addSecret,
  connectS3InFirstRun,
  createFirstRunKey,
  createIsolatedContext,
  createKeyringOnS3,
  disableVaultIdleLock,
  issueIdentityEnrollmentCode,
  localizeAppLinkForE2e,
  openVaultAfterIdentityJoin,
  openVaultPage,
  readLocalVaultYamlFromIdb,
  redeemIdentityEnrollmentCode,
  triggerVaultSyncRefresh,
  uniqueS3KeyPrefix,
  uniqueSecretKey,
} from '../../nook-web-app/e2e/helpers'

const KEYRING_NAME = 'S3 keyring'
const PAIRING_GRANT_PREFIX = 'nook:extension-pairing-grant:'

function storeIdOf(yaml: string): string {
  const storeId = yaml.match(/^store_id:\s*(\S+)/mu)?.[1]
  if (!storeId) throw new Error('store_id missing from vault yaml')
  return storeId
}

function itemCount(count: number): string {
  return enLocale.extension.companion.item_count.replace(
    '{count}',
    String(count),
  )
}

// The Simple Vault keeps a keyring, its vault and a secret on the local S3
// server, and approves the extension, which takes the keyring's S3 provider.
// Every save on a Nook page in the extension's browser also reaches the
// extension through its page bridge, so the second secret comes from another
// app of the keyring in a separate browser, after the extension's vault page
// has closed: it reaches the extension only when the extension's identity
// refresh (what the popup asks for after an unlock) reads the vault through
// S3 from its offscreen document.
test('the extension joins a keyring on S3 and reads its vault through the local S3 server', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  test.skip(isHostedSmoke, 'Hosted smoke has no local S3 server')
  testInfo.setTimeout(240_000)

  const context = await launchExtensionContext(
    testInfo.outputPath('chromium-profile-s3-keyring'),
  )
  await context.addInitScript(installMockPasskeyRuntime)

  try {
    const setupPopup = await setupPasskeyExtensionPopup(context)
    const popupUrl = `chrome-extension://${new URL(setupPopup.url()).host}/popup/index.html`
    await setupPopup.close()

    const vaultPage = await context.newPage()
    await vaultPage.goto(simpleVaultBaseUrl)
    await createFirstRunKey(vaultPage)
    await connectS3InFirstRun(vaultPage, {
      keyPrefix: uniqueS3KeyPrefix('extension'),
      identity: LocalS3Identity.DeviceA,
    })
    await createKeyringOnS3(vaultPage, KEYRING_NAME)
    await disableVaultIdleLock(vaultPage)
    await openVaultPage(vaultPage)
    await addSecret(
      vaultPage,
      uniqueSecretKey('s3-extension'),
      's3-extension-secret-value',
    )
    await triggerVaultSyncRefresh(vaultPage)
    const storeId = storeIdOf(await readLocalVaultYamlFromIdb(vaultPage))
    // While the vault is open, its member invites another app: the code
    // carries the open vault's key.
    const issued = await issueIdentityEnrollmentCode(vaultPage)
    const inviteLink = localizeAppLinkForE2e(vaultPage, issued.link)

    // Connect from the extension: the vault tab already open takes the
    // connect route, and its member approves the extension.
    const pairPopup = await context.newPage()
    await pairPopup.goto(`${popupUrl}?intent=pair`)
    const connectButton = pairPopup.getByTestId('connect-simple-vault-btn')
    await expect(connectButton).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    const connectPage = await reuseNookTabForConnect({
      context,
      nookPage: vaultPage,
      connect: () => connectButton.click(),
    })
    // The connect route opens with the keyring locked. Its request unlocks
    // the keyring, not a vault, and the consent follows in place.
    const unlockKeyring = connectPage.getByTestId('extension-request-unlock')
    await expect(unlockKeyring).toBeEnabled({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    await unlockKeyring.click()
    const consent = connectPage.getByTestId('extension-connect-consent')
    await expect(consent).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
    await approveExtensionConnect(connectPage)
    await waitForExtensionPairingReady(
      connectPage,
      async () => (await readExtensionStorage(context))[setupStorageKey],
      KEYRING_NAME,
    )

    // The extension took the keyring's one sync provider: the S3 location.
    const grant = (await readExtensionStorage(context))[
      `${PAIRING_GRANT_PREFIX}${storeId}`
    ]
    expect(grant).toMatchObject({
      vaultName: KEYRING_NAME,
      syncProviderCount: 1,
    })
    if (
      !grant ||
      typeof grant !== 'object' ||
      !('deviceId' in grant) ||
      typeof grant.deviceId !== 'string'
    ) {
      throw new Error('The S3 vault grant names no extension app')
    }

    // The extension's browser now keeps no Nook page open: nothing more
    // reaches the extension through it.
    await connectPage.close()

    // The other app joins in a separate browser and saves a second secret,
    // which it syncs to S3.
    const otherContext = await createIsolatedContext(browser)
    try {
      const otherApp = await otherContext.newPage()
      await otherApp.goto(inviteLink)
      await expect(otherApp.getByTestId('join-this-device')).toBeVisible({
        timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
      })
      await redeemIdentityEnrollmentCode(otherApp, issued.passphrase)
      await openVaultAfterIdentityJoin(otherApp)
      await addSecret(
        otherApp,
        uniqueSecretKey('s3-extension-second'),
        's3-extension-second-secret-value',
      )
      await triggerVaultSyncRefresh(otherApp)
    } finally {
      await otherContext.close()
    }

    // Before its refresh the extension holds only the first secret.
    const popup = await context.newPage()
    await popup.goto(popupUrl)
    await expect(popup.getByTestId('extension-toolbar-menu')).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    const vaultCount = popup
      .locator(
        `[data-testid="companion-vault"][data-vault-store-id="${storeId}"]`,
      )
      .getByTestId('companion-vault-count')
    await expect(vaultCount).toHaveText(itemCount(1), {
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })

    // The refresh reads the keyring's log and the vault's events from the
    // local server, so the second secret arrives only through S3.
    const refresh: IdentityVaultsRefreshMessage = {
      type: PairedVaultsMessageType.RefreshIdentity,
      deviceId: grant.deviceId,
    }
    const refreshed = await popup.evaluate(
      (message) =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage(message, resolve)
        }),
      refresh,
    )
    expect(refreshed).toEqual({ ok: true, paired: 0, awaitingGrant: 0 })

    await popup.reload()
    await expect(vaultCount).toHaveText(itemCount(2), {
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
  } finally {
    await context.close()
  }
})
