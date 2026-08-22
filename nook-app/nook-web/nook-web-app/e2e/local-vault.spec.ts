import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import {
  addSecret,
  assertVaultReady,
  BIP39_SAMPLE_WORDS,
  clearBrowserVault,
  connectLocalVault,
  deleteSecret,
  expandSecretRow,
  fillSeedPhraseGrid,
  flushNookLogPersistQueue,
  mockBip39Wordlist,
  readPersistedAppLogs,
  revealSecretInRow,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
  unlockVaultOnLogin,
  waitForVaultUnlocked,
} from './helpers'

test.describe('local vault', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await mockBip39Wordlist(page)
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('adds, reveals, searches, copies, and deletes a secret', async ({
    page,
    context,
  }) => {
    const key = uniqueSecretKey('e2e-local')
    const value = 'super-secret-value-123'

    await addSecret(page, key, value)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expandSecretRow(page, key)
    await expect(row.getByText('••••••••••••••••')).toBeVisible()

    await revealSecretInRow(row)
    await expect(row.getByText(value)).toBeVisible()

    await page.getByTestId('search-secrets').fill(key)
    await expect(row).toBeVisible()
    await page.getByTestId('search-secrets').fill('no-such-secret')
    await expect(page.getByTestId('vault-empty-search')).toBeVisible()

    await page.getByTestId('search-secrets').fill('')
    await page.getByTestId('secret-type-filter').click()
    await expect(page.getByTestId('secret-type-filter-passkey')).toBeVisible()
    await page.getByTestId('secret-type-filter-secure-note').click()
    await expect(page.getByTestId('vault-empty-search')).toBeVisible()

    await page.getByTestId('secret-type-filter').click()
    await page.getByTestId('secret-type-filter-api-key').click()
    await expect(row).toBeVisible()
    await expect(row.getByText('••••••••••••••••')).toBeVisible()

    await page.getByTestId('secret-type-filter').click()
    await page.getByTestId('secret-type-filter-all').click()
    await expect(row).toBeVisible()

    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await row.getByRole('button', { name: 'Copy secret' }).click()
    await expect(row.getByRole('button', { name: 'Copy secret' })).toBeVisible()

    await deleteSecret(page, key)
  })

  test('edits an existing secret and persists the replacement', async ({
    page,
  }) => {
    const originalKey = uniqueSecretKey('e2e-local-edit')
    const updatedKey = uniqueSecretKey('e2e-local-replaced')
    const originalValue = 'edit-me-original'
    const updatedValue = 'edit-me-updated'

    await addSecret(page, originalKey, originalValue)

    const originalRow = page
      .getByTestId('secret-row')
      .filter({ hasText: originalKey })
    await originalRow.getByTestId('edit-secret-btn').click()
    const editForm = page.getByTestId('edit-secret-form')
    await expect(editForm).toBeVisible()
    await expect(editForm.getByTestId('secret-label')).toHaveValue(originalKey)
    await expect(editForm.getByTestId('secret-value')).toHaveValue(
      originalValue,
    )

    await editForm.getByTestId('secret-label').fill(updatedKey)
    await editForm.getByTestId('secret-value').fill(updatedValue)
    await editForm.getByTestId('save-secret-btn').click()
    await expect(editForm).not.toBeVisible()
    await expect(originalRow).toHaveCount(0)

    const updatedRow = page
      .getByTestId('secret-row')
      .filter({ hasText: updatedKey })
    await expect(updatedRow).toBeVisible()
    await revealSecretInRow(updatedRow)
    await expect(updatedRow.getByText(updatedValue)).toBeVisible()

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await waitForVaultUnlocked(page)
    await assertVaultReady(page)

    const persistedRow = page
      .getByTestId('secret-row')
      .filter({ hasText: updatedKey })
    await expect(persistedRow).toBeVisible()
    await revealSecretInRow(persistedRow)
    await expect(persistedRow.getByText(updatedValue)).toBeVisible()

    await deleteSecret(page, updatedKey)
  })

  test('deletes the complete local browser copy from settings', async ({
    page,
  }) => {
    await addSecret(page, 'local-cleanup-proof', 'must-be-erased')
    await page.evaluate(async () => {
      localStorage.setItem('nook_cleanup_probe', 'local')
      sessionStorage.setItem('nook_cleanup_probe', 'session')
      document.cookie = 'nook_cleanup_probe=cookie; Path=/; SameSite=Lax'
      const cache = await caches.open('nook-cleanup-probe')
      await cache.put('/cleanup-probe', new Response('cached'))
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_file_sync', 1)
        request.onupgradeneeded = () => {
          request.result.createObjectStore('directory_handles', {
            keyPath: 'id',
          })
        }
        request.onerror = () =>
          reject(request.error ?? new Error('local folder db open failed'))
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('directory_handles', 'readwrite')
          transaction.objectStore('directory_handles').put({
            id: 'nook-cleanup-probe',
            handle: 'probe',
          })
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
          transaction.onerror = () =>
            reject(transaction.error ?? new Error('local folder seed failed'))
        }
      })
    })

    const otherTab = await page.context().newPage()
    await otherTab.goto('/')
    await otherTab.waitForFunction(() =>
      Boolean(
        (
          window as Window & {
            __nookVault?: { enqueueStorage: (operation: () => void) => void }
          }
        ).__nookVault,
      ),
    )
    await otherTab.evaluate(() => {
      sessionStorage.setItem('nook_cleanup_probe', 'other-tab-session')
    })

    await page.getByTestId('vault-settings-tab').click()
    await expect(page.getByTestId('storage-settings-panel')).toBeVisible()
    const dangerSection = page.getByTestId('vault-danger-section')
    await dangerSection.getByRole('button').first().click()
    await page.getByTestId('delete-local-vault-button').click()
    await expect(
      page.getByTestId('delete-local-vault-confirmation'),
    ).toBeVisible()
    await page.getByTestId('delete-local-vault-cancel').click()
    await expect(
      page.getByTestId('delete-local-vault-confirmation'),
    ).not.toBeVisible()

    await page.getByTestId('delete-local-vault-button').click()
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/'),
      page.getByTestId('delete-local-vault-confirm').click(),
    ])

    const remaining = await page.evaluate(async () => {
      const countRecords = (databaseName: string) =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open(databaseName)
          request.onerror = () =>
            reject(request.error ?? new Error(`${databaseName} open failed`))
          request.onsuccess = () => {
            const db = request.result
            const storeNames = Array.from(db.objectStoreNames)
            if (storeNames.length === 0) {
              db.close()
              resolve(0)
              return
            }
            const transaction = db.transaction(storeNames, 'readonly')
            let count = 0
            for (const storeName of storeNames) {
              const countRequest = transaction.objectStore(storeName).count()
              countRequest.onsuccess = () => {
                count += countRequest.result
              }
            }
            transaction.oncomplete = () => {
              db.close()
              resolve(count)
            }
            transaction.onerror = () =>
              reject(
                transaction.error ?? new Error(`${databaseName} count failed`),
              )
          }
        })
      const recordCounts = await Promise.all(
        ['nook_db', 'nook_auth', 'nook_logs', 'nook_file_sync'].map(
          countRecords,
        ),
      )
      return {
        recordCounts,
        localPresent: Boolean(localStorage.getItem('nook_cleanup_probe')),
        sessionPresent: Boolean(sessionStorage.getItem('nook_cleanup_probe')),
        caches: await caches.keys(),
        cookie: document.cookie,
      }
    })
    expect(remaining.recordCounts).toEqual([0, 0, 0, 0])
    expect(remaining.localPresent).toBe(false)
    expect(remaining.sessionPresent).toBe(false)
    expect(remaining.caches).not.toContain('nook-cleanup-probe')
    expect(remaining.cookie).not.toContain('nook_cleanup_probe=')
    await expect
      .poll(() =>
        otherTab.evaluate(async () => {
          const vault = (
            window as Window & {
              __nookVault?: {
                enqueueStorage: (operation: () => void) => Promise<void>
                isAuthenticated: boolean
              }
            }
          ).__nookVault
          if (!vault || vault.isAuthenticated) return false
          const cleanupProbe = sessionStorage
            .getItem('nook_cleanup_probe')
            ?.valueOf()
          if (cleanupProbe) {
            return false
          }
          try {
            await vault.enqueueStorage(() => {})
            return false
          } catch {
            return true
          }
        }),
      )
      .toBe(true)
    await otherTab.close()
  })

  test('password generator fills the secret value field', async ({ page }) => {
    await assertVaultReady(page)
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-login').click()
    await page.getByTestId('password-generator-toggle').click()
    await page.getByTestId('secret-value').fill('')
    await page.getByTestId('generate-password-btn').click()
    const generated = await page.getByTestId('secret-value').inputValue()
    expect(generated.length).toBeGreaterThanOrEqual(8)
  })

  test('adds an API key without a website URL', async ({ page }) => {
    const value = 'sk-test-api-key-no-website'

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-api-key').click()
    await page.getByTestId('secret-value').fill(value)
    await expect(page.getByTestId('save-secret-btn')).toBeEnabled()
    await page.getByTestId('save-secret-btn').click()

    const row = page
      .getByTestId('vault-group-api-key')
      .getByTestId('secret-row')
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await revealSecretInRow(row)
    await expect(row.getByText(value)).toBeVisible()
  })

  test('groups logins, API keys, and seed phrases', async ({ page }) => {
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-login').click()
    await page.getByTestId('secret-label').fill('https://login.example.com')
    await page.getByTestId('login-username').fill('alice')
    await page.getByTestId('secret-value').fill('login-password')
    await page.getByTestId('login-notes').fill('Personal account')
    await page.getByTestId('save-secret-btn').click()

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-api-key').click()
    await page.getByTestId('secret-label').fill('https://api.example.com')
    await page.getByTestId('secret-value').fill('api-key-value')
    await page.getByTestId('api-key-expiration').fill('2030-01-01')
    await page.getByTestId('save-secret-btn').click()

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-seed-phrase').click()
    await page.getByTestId('secret-label').fill('Main wallet')
    await fillSeedPhraseGrid(page, BIP39_SAMPLE_WORDS)
    await expect(page.getByTestId('seed-phrase-valid')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await page.getByTestId('save-secret-btn').click()

    const loginGroup = page.getByTestId('vault-group-login')
    await expect(loginGroup.getByTestId('secret-row-heading')).toHaveText(
      'login.example.com',
    )
    await expect(loginGroup.getByTestId('secret-row-account')).toHaveText(
      'alice',
    )
    await expandSecretRow(page, 'alice')
    await expect(page.getByTestId('vault-group-login')).toContainText(
      'login.example.com',
    )
    await expandSecretRow(page, 'api.example.com')
    await expect(page.getByTestId('vault-group-api-key')).toContainText(
      '2030-01-01',
    )
    await expect(page.getByTestId('vault-group-seed-phrase')).toContainText(
      'Main wallet',
    )
  })

  test('creates, edits, reloads, and deletes a secure note with markdown', async ({
    page,
  }) => {
    const title = uniqueSecretKey('e2e-note')
    const updatedTitle = `${title}-updated`
    const noteBody = '# Recovery\n\n- step one\n\nUse **backup** code `1234`.'
    const updatedBody =
      '# Updated recovery\n\n- step two\n\nUse **replacement** code `5678`.'

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-secure-note').click()
    await page.getByTestId('secret-label').fill(title)
    await page.getByTestId('secret-value').fill(noteBody)
    await page.getByTestId('markdown-tab-preview').click()
    await expect(page.getByTestId('markdown-preview')).toContainText('Recovery')
    await expect(page.getByTestId('markdown-preview').locator('h1')).toHaveText(
      'Recovery',
    )
    await expect(
      page.getByTestId('markdown-preview').locator('strong'),
    ).toHaveText('backup')
    await expect(
      page.getByTestId('markdown-preview').locator('ul li'),
    ).toHaveCount(1)
    await page.getByTestId('save-secret-btn').click()

    const row = page.getByTestId('secret-row').filter({ hasText: title })
    await expect(page.getByTestId('vault-group-secure-note')).toBeVisible()
    await expect(row).toBeVisible()

    await revealSecretInRow(row)
    await expect(row.getByRole('heading', { name: 'Recovery' })).toBeVisible()
    await expect(row.getByText('backup')).toBeVisible()
    await expect(row.getByText('1234')).toBeVisible()

    await row.getByTestId('edit-secret-btn').click()
    const editForm = page.getByTestId('edit-secret-form')
    await expect(editForm.getByTestId('secret-label')).toHaveValue(title)
    await expect(editForm.getByTestId('secret-value')).toHaveValue(noteBody)
    await editForm.getByTestId('secret-label').fill(updatedTitle)
    await editForm.getByTestId('secret-value').fill(updatedBody)
    await editForm.getByTestId('save-secret-btn').click()
    await expect(editForm).not.toBeVisible()
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toHaveCount(0)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await waitForVaultUnlocked(page)
    await assertVaultReady(page)
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toHaveCount(0)

    const updatedRow = page
      .getByTestId('secret-row')
      .filter({ hasText: updatedTitle })
    await expect(updatedRow).toBeVisible()
    await revealSecretInRow(updatedRow)
    await expect(
      updatedRow.getByRole('heading', { name: 'Updated recovery' }),
    ).toBeVisible()
    await expect(updatedRow.getByText('replacement')).toBeVisible()
    await expect(updatedRow.getByText('5678')).toBeVisible()

    await deleteSecret(page, updatedTitle)
  })

  test('validates, masks, persists, and keeps credit-card secrets out of logs', async ({
    page,
    context,
  }) => {
    const title = uniqueSecretKey('e2e-card')
    const updatedTitle = `${title}-updated`
    const cardNumber = '4111111111111111'
    const cvv = '123'
    const notes = 'private billing note'

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-credit-card').click()
    await page.getByTestId('secret-label').fill(title)
    await page.getByTestId('credit-card-cardholder').fill('Ada Lovelace')
    await page.getByTestId('credit-card-number').fill('4111111111111112')
    await page.getByTestId('credit-card-exp-month').fill('12')
    await page.getByTestId('credit-card-exp-year').fill('2030')
    await page.getByTestId('credit-card-cvv').fill(cvv)
    await page.getByTestId('credit-card-notes').fill(notes)
    await page.getByTestId('save-secret-btn').click()
    await expect(page.getByTestId('secret-form-error')).toBeVisible()

    await page.getByTestId('credit-card-number').fill(cardNumber)
    await page.getByTestId('save-secret-btn').click()

    const row = page.getByTestId('secret-row').filter({ hasText: title })
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await expect(row).toContainText('1111')
    await expect(row).not.toContainText(cardNumber)
    await expandSecretRow(page, title)
    await expect(row.getByTestId('credit-card-number-value')).toHaveText(
      '•••• 1111',
    )
    await expect(row.getByTestId('credit-card-cvv-value')).toHaveText('•••')

    await revealSecretInRow(row)
    await expect(row.getByTestId('credit-card-number-value')).toHaveText(
      cardNumber,
    )
    await expect(row.getByTestId('credit-card-cvv-value')).toHaveText(cvv)
    await expect(row).toContainText(notes)

    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await row.getByRole('button', { name: 'Copy name on card' }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('Ada Lovelace')
    await row.getByRole('button', { name: 'Copy card number' }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(cardNumber)
    await row.getByRole('button', { name: 'Copy expiration' }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('12/2030')
    await row.getByRole('button', { name: 'Copy security code' }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(cvv)

    await flushNookLogPersistQueue(page)
    const logs = await readPersistedAppLogs(page, 500)
    const serializedLogPayloads = JSON.stringify(
      logs.map(({ message, data }) => ({ message, data })),
    )
    expect(serializedLogPayloads).not.toContain(cardNumber)
    expect(serializedLogPayloads).not.toContain(cvv)
    expect(serializedLogPayloads).not.toContain(notes)

    await row.getByTestId('edit-secret-btn').click()
    const editForm = page.getByTestId('edit-secret-form')
    await expect(editForm.getByTestId('credit-card-number')).toHaveValue(
      cardNumber,
    )
    await editForm.getByTestId('secret-label').fill(updatedTitle)
    await editForm.getByTestId('credit-card-cvv').fill('9876')
    await editForm.getByTestId('save-secret-btn').click()
    await expect(editForm).not.toBeVisible()
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByTestId('secret-row').filter({ hasText: updatedTitle }),
    ).toBeVisible()
    await flushNookLogPersistQueue(page)
    const replacementLogs = await readPersistedAppLogs(page, 500)
    const serializedReplacementLogPayloads = JSON.stringify(
      replacementLogs.map(({ message, data }) => ({ message, data })),
    )
    expect(serializedReplacementLogPayloads).not.toContain(cardNumber)
    expect(serializedReplacementLogPayloads).not.toContain('9876')
    expect(serializedReplacementLogPayloads).not.toContain(notes)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await waitForVaultUnlocked(page)
    await assertVaultReady(page)

    const persistedRow = page
      .getByTestId('secret-row')
      .filter({ hasText: updatedTitle })
    await expect(persistedRow).toBeVisible()
    await revealSecretInRow(persistedRow)
    await expect(
      persistedRow.getByTestId('credit-card-number-value'),
    ).toHaveText(cardNumber)
    await expect(persistedRow.getByTestId('credit-card-cvv-value')).toHaveText(
      '9876',
    )

    await deleteSecret(page, updatedTitle)
  })

  test('adds, reveals, and downloads a file attachment', async ({ page }) => {
    const title = uniqueSecretKey('e2e-file')
    const fileContents = 'nook file attachment payload'
    const fileContentsBase64 = Buffer.from(fileContents, 'utf8').toString(
      'base64',
    )

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-file-attachment').click()
    await page.getByTestId('file-attachment-title').fill(title)
    await page.getByTestId('file-attachment-input').setInputFiles({
      name: 'recovery.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(fileContents, 'utf8'),
    })
    await expect(page.getByTestId('file-attachment-selected')).toContainText(
      'recovery.txt',
    )
    await page.getByTestId('save-secret-btn').click()

    const row = page.getByTestId('secret-row').filter({ hasText: title })
    await expect(page.getByTestId('vault-group-file-attachment')).toBeVisible()
    await expect(row).toBeVisible()

    await expandSecretRow(page, title)
    await expect(row.getByTestId('file-attachment-name')).toHaveText(
      'recovery.txt',
    )
    await revealSecretInRow(row)
    const downloadPromise = page.waitForEvent('download')
    await row.getByTestId('download-file-attachment-btn').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('recovery.txt')
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()
    expect(readFileSync(downloadPath!, 'utf8')).toBe(fileContents)

    await flushNookLogPersistQueue(page)
    const logs = await readPersistedAppLogs(page, 500)
    const serializedLogPayloads = JSON.stringify(
      logs.map(({ message, data }) => ({ message, data })),
    )
    expect(serializedLogPayloads).not.toContain(fileContents)
    expect(serializedLogPayloads).not.toContain(fileContentsBase64)

    await deleteSecret(page, title)
  })

  test('rejects a file attachment above the documented one MiB limit', async ({
    page,
  }) => {
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-file-attachment').click()
    await page.getByTestId('file-attachment-input').setInputFiles({
      name: 'oversized.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(1_048_577, 7),
    })

    await expect(page.getByTestId('file-attachment-error')).toBeVisible()
    await expect(page.getByTestId('file-attachment-selected')).toHaveCount(0)
    await expect(page.getByTestId('save-secret-btn')).toBeDisabled()
    await expect(page.getByTestId('vault-group-file-attachment')).toHaveCount(0)
  })

  test('adds an authenticator with a simple setup-key form and live TOTP code', async ({
    page,
  }) => {
    const issuer = uniqueSecretKey('e2e-authenticator')
    const account = `${issuer}@example.com`

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-authenticator').click()
    await page.getByTestId('authenticator-issuer').fill(issuer)
    await page.getByTestId('authenticator-account').fill(account)
    await page.getByTestId('authenticator-secret').fill('not-valid!')
    await expect(page.getByTestId('authenticator-algorithm')).toHaveCount(0)
    await expect(page.getByTestId('authenticator-digits')).toHaveCount(0)
    await expect(page.getByTestId('authenticator-period')).toHaveCount(0)
    await expect(page.getByTestId('authenticator-backup-codes')).toHaveCount(0)
    await page.getByTestId('save-secret-btn').click()
    await expect(page.getByTestId('secret-form-error')).toBeVisible()
    await expect(page.getByTestId('secret-form-error')).toContainText(
      'Enter a valid Base32 authenticator secret.',
    )

    await page.getByTestId('authenticator-secret').fill('JBSWY3DPEHPK3PXP')
    await page.getByTestId('save-secret-btn').click()

    const row = page.getByTestId('secret-row').filter({ hasText: account })
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await row.getByTestId('secret-row-toggle').click()
    await expect(row.getByTestId('authenticator-current-code')).toHaveText(
      '••••••',
    )
    await expect(row.getByTestId('authenticator-backup-codes')).toHaveCount(0)

    await revealSecretInRow(row)
    await expect(row.getByTestId('authenticator-current-code')).toHaveText(
      /^\d{6}$/,
      { timeout: UI_TIMEOUT_MS },
    )

    await expect(row.getByText('JBSWY3DPEHPK3PXP')).toBeVisible()

    await deleteSecret(page, issuer)
  })

  test('adds a non-default authenticator from an otpauth URI without separate protocol controls', async ({
    page,
  }) => {
    const issuer = uniqueSecretKey('e2e-authenticator-uri')
    const account = `${issuer}+alerts@example.com`
    const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=JBSWY3DPEHPK3PXP&issuer=${encodeURIComponent(issuer)}&algorithm=SHA256&digits=8&period=45`

    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-authenticator').click()
    await page.getByTestId('authenticator-secret').fill(uri)
    await expect(page.getByTestId('save-secret-btn')).toBeEnabled()
    await page.getByTestId('save-secret-btn').click()

    const row = page.getByTestId('secret-row').filter({ hasText: account })
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await row.getByTestId('secret-row-toggle').click()
    await revealSecretInRow(row)
    await expect(row.getByTestId('authenticator-current-code')).toHaveText(
      /^\d{8}$/,
      { timeout: UI_TIMEOUT_MS },
    )
    await expect(row.getByTestId('authenticator-current-code')).toHaveAttribute(
      'data-period',
      '45',
    )

    await deleteSecret(page, issuer)
  })

  test('persists secrets after reload', async ({ page }) => {
    const key = uniqueSecretKey('e2e-local-persist')
    const value = 'persist-me'

    await addSecret(page, key, value)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await waitForVaultUnlocked(page)
    await assertVaultReady(page)

    const row = page.getByTestId('secret-row').filter({ hasText: key })
    await expect(row).toBeVisible()
    await revealSecretInRow(row)
    await expect(row.getByText(value)).toBeVisible()

    await deleteSecret(page, key)
  })
})
