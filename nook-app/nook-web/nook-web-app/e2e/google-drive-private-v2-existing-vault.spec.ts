import { expect, test } from './fixtures'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'
import {
  connectGoogleDriveSyncProviderFromSettings,
  createIsolatedContext,
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installGoogleOAuthMock,
  readLocalVaultYamlFromIdb,
  setupGoogleDriveProvider,
} from './helpers'
import { connectSyncGenesisDevice, E2eSyncProviderId } from './sync-provider'

const PRIVATE_V2_DRIVE_TOKEN = 'ya29.e2e_private_v2_existing_vault'
const PRIVATE_V2_DRIVE_FILE_NAME = 'nook-events'
const PRIVATE_V2_EMPTY_DRIVE_FILE_NAME = 'nook-events-empty'
const PRIVATE_V2_NEW_VAULT_FILE_NAME = 'nook-events-new-vault'

function safeDriveQuery(url: URL): string {
  const safeQuery = new URLSearchParams()
  for (const key of ['q', 'spaces', 'fields', 'pageSize', 'alt']) {
    for (const value of url.searchParams.getAll(key)) {
      safeQuery.append(key, value)
    }
  }
  return safeQuery.toString()
}

test('discovers an existing Private Drive v2 vault, distinguishes an empty provider, and creates a named new vault', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000)

  const driveStub = createLocalE2eGoogleDriveVaultStub(
    '',
    PRIVATE_V2_DRIVE_FILE_NAME,
  )
  await installGoogleOAuthMock(page, PRIVATE_V2_DRIVE_TOKEN)
  await driveStub.install(page, {
    accessToken: PRIVATE_V2_DRIVE_TOKEN,
    fileName: PRIVATE_V2_DRIVE_FILE_NAME,
  })
  await connectSyncGenesisDevice(
    page,
    {
      providerId: E2eSyncProviderId.GoogleDrive,
      pat: PRIVATE_V2_DRIVE_TOKEN,
      repoName: PRIVATE_V2_DRIVE_FILE_NAME,
      stub: driveStub,
    },
    { privateDriveFolderV2: true },
  )

  const genesisYaml = await readLocalVaultYamlFromIdb(page)
  expect(genesisYaml.trim().length).toBeGreaterThan(0)
  driveStub.setVaultYaml(genesisYaml)

  const privateFolderName = `nook-events-v2-${PRIVATE_V2_DRIVE_FILE_NAME}`
  const privateFolderId = `e2e-drive-private-folder-${Buffer.from(
    privateFolderName,
  ).toString('base64url')}`
  await expect
    .poll(() => driveStub.getEventFileCountForParent(privateFolderId), {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    .toBeGreaterThan(0)
  expect(driveStub.getEventFileCountForParent('appDataFolder')).toBe(0)

  const existingContext = await createIsolatedContext(browser)
  const existingPage = await existingContext.newPage()
  try {
    await installGoogleOAuthMock(existingPage, PRIVATE_V2_DRIVE_TOKEN)
    await driveStub.install(existingPage, {
      accessToken: PRIVATE_V2_DRIVE_TOKEN,
      fileName: PRIVATE_V2_DRIVE_FILE_NAME,
    })
    const driveFileResponses: Array<{
      path: string
      query: string
      status: number
    }> = []
    existingPage.on('response', (response) => {
      const request = response.request()
      const url = new URL(response.url())
      if (
        request.method() === 'GET' &&
        url.origin === 'https://www.googleapis.com' &&
        url.pathname.startsWith('/drive/v3/files')
      ) {
        driveFileResponses.push({
          path: url.pathname,
          query: safeDriveQuery(url),
          status: response.status(),
        })
      }
    })
    await existingPage.goto('/app/')
    await setupGoogleDriveProvider(existingPage, PRIVATE_V2_DRIVE_FILE_NAME)
    await existingPage.getByTestId('connect-provider-btn').click()
    try {
      await expect(
        existingPage.getByTestId('devices-access-nudge'),
      ).toBeVisible()
      await expect(existingPage.locator('body')).toContainText(
        'Join this vault',
      )
      await expect(existingPage.locator('body')).toContainText(
        'This browser is not enrolled yet',
      )
      const privateFolderName = `nook-events-v2-${PRIVATE_V2_DRIVE_FILE_NAME}`
      const privateFolderLookup = driveFileResponses.find(
        ({ path, query }) =>
          path === '/drive/v3/files' &&
          new URLSearchParams(query).get('q')?.includes(privateFolderName),
      )
      if (!privateFolderLookup || privateFolderLookup.status !== 200) {
        throw new Error(
          'Private v2 folder lookup was not observed with HTTP 200.',
        )
      }
    } catch {
      const visiblePageText = (
        await existingPage.locator('body').innerText()
      ).slice(0, 4000)
      throw new Error(
        [
          'Existing Private Drive v2 discovery did not reach the expected join state.',
          `Drive files.list/get responses: ${JSON.stringify(driveFileResponses)}`,
          `Rendered page text: ${visiblePageText}`,
        ].join('\n'),
      )
    }
  } finally {
    await existingContext.close()
  }

  const emptyDriveStub = createLocalE2eGoogleDriveVaultStub(
    '',
    PRIVATE_V2_EMPTY_DRIVE_FILE_NAME,
  )
  const emptyContext = await createIsolatedContext(browser)
  const emptyPage = await emptyContext.newPage()
  try {
    await installGoogleOAuthMock(emptyPage, PRIVATE_V2_DRIVE_TOKEN)
    await emptyDriveStub.install(emptyPage, {
      accessToken: PRIVATE_V2_DRIVE_TOKEN,
      fileName: PRIVATE_V2_EMPTY_DRIVE_FILE_NAME,
    })
    await emptyPage.goto('/app/')
    await setupGoogleDriveProvider(emptyPage, PRIVATE_V2_EMPTY_DRIVE_FILE_NAME)
    await emptyPage.getByTestId('connect-provider-btn').click()
    await expect(emptyPage.getByTestId('vault-error')).toContainText(
      'No existing vault was found in this provider',
    )
    await expect(
      emptyPage.getByTestId('existing-vault-recovery-summary'),
    ).toHaveCount(0)
    await expect(emptyPage.getByTestId('join-enrollment-confirm')).toHaveCount(
      0,
    )
    await expect(emptyPage.getByTestId('vault-panel')).toHaveCount(0)
    const changeProviderButton = emptyPage.getByTestId('cancel-provider-setup')
    await expect(changeProviderButton).toBeVisible()
    await changeProviderButton.click()
    await expect(emptyPage.getByTestId('provider-picker-list')).toBeVisible()
  } finally {
    await emptyContext.close()
  }

  const newVaultDriveStub = createLocalE2eGoogleDriveVaultStub(
    '',
    PRIVATE_V2_NEW_VAULT_FILE_NAME,
  )
  const newVaultContext = await createIsolatedContext(browser)
  const newVaultPage = await newVaultContext.newPage()
  try {
    await newVaultDriveStub.install(newVaultPage, {
      accessToken: PRIVATE_V2_DRIVE_TOKEN,
      fileName: PRIVATE_V2_NEW_VAULT_FILE_NAME,
    })
    await newVaultPage.goto('/app/')
    await createLocalVaultOnLogin(newVaultPage, PRIVATE_V2_NEW_VAULT_FILE_NAME)
    await connectGoogleDriveSyncProviderFromSettings(
      newVaultPage,
      PRIVATE_V2_NEW_VAULT_FILE_NAME,
      PRIVATE_V2_DRIVE_TOKEN,
    )

    const newVaultFolderName = `nook-events-v2-${PRIVATE_V2_NEW_VAULT_FILE_NAME}`
    const newVaultFolderId = `e2e-drive-private-folder-${Buffer.from(
      newVaultFolderName,
    ).toString('base64url')}`
    await expect
      .poll(
        () => newVaultDriveStub.getEventFileCountForParent(newVaultFolderId),
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      .toBeGreaterThan(0)
    expect(newVaultDriveStub.getEventFileCountForParent('appDataFolder')).toBe(
      0,
    )
  } finally {
    await newVaultContext.close()
  }
})
