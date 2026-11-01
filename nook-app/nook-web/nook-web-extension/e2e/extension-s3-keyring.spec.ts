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
  authorizeDeviceProtection,
  connectS3InFirstRun,
  createFirstRunKey,
  createKeyringOnS3,
  disableVaultIdleLock,
  openVaultPage,
  readLocalVaultYamlFromIdb,
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

// The Simple Vault keeps a keyring, its vault and a secret on the local S3
// server. The approval adds the extension to the keyring with the keyring's
// S3 provider. With the vault page closed, the extension's identity refresh
// (what the popup asks for after an unlock) reads the keyring's log and the
// vault's events through S3 from its offscreen document.
test('the extension joins a keyring on S3 and reads its vault through the local S3 server', async ({
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
    const consent = connectPage.getByTestId('extension-connect-consent')
    await expect(
      consent.or(connectPage.getByTestId('identity-vault-row')).first(),
    ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
    await authorizeDeviceProtection(connectPage)
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

    // From here only S3 holds the vault: no Nook page is open to hand its
    // records over. The refresh fails unless the offscreen document reads
    // the keyring's log and the vault's events from the local server.
    await connectPage.close()
    const popup = await context.newPage()
    await popup.goto(popupUrl)
    await expect(popup.getByTestId('extension-toolbar-menu')).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
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

    // The popup shows the vault read through S3 with its one secret.
    await popup.reload()
    const vaultRow = popup.locator(
      `[data-testid="companion-vault"][data-vault-store-id="${storeId}"]`,
    )
    await expect(vaultRow.getByTestId('companion-vault-count')).toHaveText(
      enLocale.extension.companion.item_count.replace('{count}', '1'),
      { timeout: EXTENSION_UNLOCK_TIMEOUT_MS },
    )
  } finally {
    await context.close()
  }
})
