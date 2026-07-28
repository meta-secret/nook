import { expect, type Page } from '@playwright/test'
import { assertEnrolledVaultYaml, assertGenesisVaultYaml } from '../vault-yaml'
import { keepVaultIdleLockDisabled } from './device-enrollment'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  configuredGithubSyncTimeoutMs,
} from './environment'
import {
  GithubE2eTarget,
  assertNoVaultError,
  triggerVaultSyncRefresh,
  waitForGithubVaultState,
} from './github-sync'
import {
  seedOauthFileSyncProvidersWhileUnlocked,
  syncSecretCount,
} from './local-sync'
import { assertVaultReady, revealSecretInRow } from './settings-auth'
import {
  waitForStorageChainIdle,
  waitForVaultOperationsIdle,
} from './vault-runtime'

export async function addSecret(
  page: Page,
  key: string,
  value: string,
  github?: GithubE2eTarget,
) {
  const beforeCount = github ? await syncSecretCount(github) : 0
  await keepVaultIdleLockDisabled(page)
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  const addButton = page.getByTestId('add-secret-btn')
  await expect(addButton).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(addButton).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await addButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(page.getByTestId('add-secret-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page
    .getByTestId('item-type-api-key')
    .click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await page
    .getByTestId('secret-label')
    .fill(key, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await page
    .getByTestId('secret-value')
    .fill(value, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  const saveButton = page.getByTestId('save-secret-btn')
  await expect(saveButton).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await saveButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await waitForVaultOperationsIdle(page)
  await assertNoVaultError(page)
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  try {
    await expect(row).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  } catch (error) {
    const debug = await page.evaluate(async (expectedKey) => {
      const vault = (
        window as Window & {
          __nookVault?: {
            secrets?: unknown[]
            storageMode?: string
            localVaultPresent?: boolean
            syncProviders?: unknown[]
            isSaving?: boolean
            isSyncing?: boolean
            errorMsg?: string
          }
        }
      ).__nookVault
      const idbYaml = await new Promise<string>((resolve) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () => resolve(`idb-open-error:${request.error}`)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('vault', 'readonly')
          const store = tx.objectStore('vault')
          const activeReq = store.get('active_vault_id')
          activeReq.onerror = () => resolve(`idb-read-error:${activeReq.error}`)
          activeReq.onsuccess = () => {
            const activeId = String(activeReq.result ?? '').trim()
            if (!activeId) {
              resolve('')
              return
            }
            const getReq = store.get(`vault:${activeId}`)
            getReq.onerror = () => resolve(`idb-read-error:${getReq.error}`)
            getReq.onsuccess = () =>
              resolve(typeof getReq.result === 'string' ? getReq.result : '')
          }
          tx.oncomplete = () => db.close()
        }
      })
      return {
        secrets: vault?.secrets?.length ?? undefined,
        storageMode: vault?.storageMode ?? undefined,
        localVaultPresent: vault?.localVaultPresent ?? undefined,
        syncProviders: vault?.syncProviders?.length ?? undefined,
        isSaving: vault?.isSaving ?? undefined,
        isSyncing: vault?.isSyncing ?? undefined,
        errorMsg: vault?.errorMsg ?? undefined,
        localYamlHasKey: idbYaml.includes(expectedKey),
        localYamlSecretCount:
          idbYaml.match(/\n\s*-\s+id:\s+secret_/g)?.length ?? 0,
      }
    }, key)
    throw new Error(
      `Secret row "${key}" did not appear. Debug: ${JSON.stringify(debug)}. Original: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    )
  }
  if (github) {
    await waitForStorageChainIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)
    await waitForGithubVaultState(
      github,
      (yaml) => yaml.secretIds.length > beforeCount,
      { page, timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
  }
}

export async function expandSecretRow(page: Page, key: string) {
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  const toggle = row.getByTestId('secret-row-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
}

export async function revealSecretValue(page: Page, key: string) {
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await revealSecretInRow(row)
  const grid = row.getByTestId('seed-phrase-grid')
  if (await grid.isVisible()) {
    const words = await row.getByTestId(/^seed-word-\d+$/).allTextContents()
    return words
      .map((word) => word.trim())
      .filter(Boolean)
      .join(' ')
  }
  const code = row.locator('code')
  await expect(code).toBeVisible()
  return (await code.textContent()) ?? ''
}

export async function waitForSecretOnDevice(
  page: Page,
  key: string,
  github?: GithubE2eTarget,
) {
  if (github) {
    await waitForGithubVaultState(github, (yaml) => yaml.secretIds.length > 0)
  }
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  const timeout = github ? configuredGithubSyncTimeoutMs() : UI_TIMEOUT_MS

  await expect
    .poll(
      async () => {
        if (await row.isVisible()) return true
        if (github) {
          try {
            await triggerVaultSyncRefresh(page)
          } catch {
            await page.evaluate(async () => {
              const vault = (
                window as Window & {
                  __nookVault?: {
                    manualSync?: () => Promise<void>
                    syncFromStorage?: (opts?: {
                      force?: boolean
                    }) => Promise<void>
                  }
                }
              ).__nookVault
              if (vault?.manualSync) {
                await vault.manualSync()
              } else {
                await vault?.syncFromStorage?.({ force: true })
              }
            })
          }
        } else {
          await page.evaluate(async () => {
            const vault = (
              window as Window & {
                __nookVault?: {
                  syncFromStorage?: (opts?: {
                    force?: boolean
                  }) => Promise<void>
                }
              }
            ).__nookVault
            await vault?.syncFromStorage?.({ force: true })
          })
        }
        await waitForVaultOperationsIdle(page)
        return row.isVisible()
      },
      { timeout },
    )
    .toBe(true)
}

export async function deleteSecret(
  page: Page,
  key: string,
  github?: GithubE2eTarget,
) {
  const beforeCount = github ? await syncSecretCount(github) : 0
  await waitForSecretOnDevice(page, key, github)
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
  const deleteBtn = row.getByTestId('delete-secret-btn')
  await expect(deleteBtn).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await deleteBtn.click()
  await expect(row).toHaveCount(0, { timeout: UI_TIMEOUT_MS })
  if (github) {
    await waitForGithubVaultState(
      github,
      (yaml) => yaml.secretIds.length < beforeCount,
      { page },
    )
  }
}

export async function assertGenesisVaultOnGithub(
  target: GithubE2eTarget | string,
  repoName?: string,
) {
  const resolved: GithubE2eTarget =
    typeof target === 'string' ? { pat: target, repoName: repoName! } : target
  const snapshot = await waitForGithubVaultState(
    resolved,
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
  )
  assertGenesisVaultYaml(snapshot)
  return snapshot
}

export async function assertEnrolledVaultOnGithub(
  target: GithubE2eTarget | string,
  repoNameOrMembers?: string | number,
  expectedMembers?: number,
  page?: Page,
) {
  const resolved: GithubE2eTarget =
    typeof target === 'string'
      ? { pat: target, repoName: repoNameOrMembers as string }
      : target
  const members =
    typeof target === 'string'
      ? (expectedMembers as number)
      : (repoNameOrMembers as number)
  const snapshot = await waitForGithubVaultState(
    resolved,
    (yaml) =>
      yaml.joinEntries.length === 0 &&
      yaml.authPkIds.length === members &&
      yaml.memberPkIds.length === members,
    { page },
  )
  assertEnrolledVaultYaml(snapshot, members)
  return snapshot
}

/** @deprecated Use {@link seedOauthFileSyncProvidersWhileUnlocked}. */
export const seedSyncProvidersWhileUnlocked =
  seedOauthFileSyncProvidersWhileUnlocked
