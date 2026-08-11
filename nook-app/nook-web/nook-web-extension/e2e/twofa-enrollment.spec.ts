import { expect, test } from '@playwright/test'
import { readExtensionPairingStorage } from './helpers/extension-pairing-storage'
import { launchPairedPinExtension } from './helpers/paired-pin-extension'
import { startMockAuthServer } from './mock-auth'
import { ExtensionConnectScope } from '../../nook-web-shared/src/extension/extension-connect-scope'
import { WebsiteAuthenticatorBackupAttachMessageMode } from '../src/lib/enrollment-messages'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'

type ExtensionPairingSessionGrant = {
  vaultStoreId: string
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

enum ExtensionPairingSessionGrantParseKind {
  Invalid = 'invalid',
  Valid = 'valid',
}

type ExtensionPairingSessionGrantParse =
  | { kind: ExtensionPairingSessionGrantParseKind.Invalid }
  | {
      kind: ExtensionPairingSessionGrantParseKind.Valid
      grant: ExtensionPairingSessionGrant
    }

function extensionPairingSessionGrant(
  value: unknown,
): ExtensionPairingSessionGrantParse {
  if (!value || typeof value !== 'object') {
    return { kind: ExtensionPairingSessionGrantParseKind.Invalid }
  }
  if (
    !('vaultStoreId' in value) ||
    typeof value.vaultStoreId !== 'string' ||
    !('deviceId' in value) ||
    typeof value.deviceId !== 'string' ||
    !('devicePublicKey' in value) ||
    typeof value.devicePublicKey !== 'string' ||
    !('deviceSigningPublicKey' in value) ||
    typeof value.deviceSigningPublicKey !== 'string' ||
    !('scopes' in value) ||
    !Array.isArray(value.scopes) ||
    !value.scopes.includes(ExtensionConnectScope.PasswordFilling)
  ) {
    return { kind: ExtensionPairingSessionGrantParseKind.Invalid }
  }
  return {
    kind: ExtensionPairingSessionGrantParseKind.Valid,
    grant: {
      vaultStoreId: value.vaultStoreId,
      deviceId: value.deviceId,
      devicePublicKey: value.devicePublicKey,
      deviceSigningPublicKey: value.deviceSigningPublicKey,
    },
  }
}

function parsedExtensionPairingSessionGrants(
  entries: [string, unknown][],
): ExtensionPairingSessionGrant[] {
  const grants: ExtensionPairingSessionGrant[] = []
  for (const [key, value] of entries) {
    if (!key.startsWith('nook:extension-pairing-grant:')) continue
    const parsed = extensionPairingSessionGrant(value)
    if (parsed.kind === ExtensionPairingSessionGrantParseKind.Valid) {
      grants.push(parsed.grant)
    }
  }
  return grants
}

async function listExtensionAuthenticators(
  context: Awaited<ReturnType<typeof launchPairedPinExtension>>['context'],
): Promise<Array<{ issuer: string; account: string }>> {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 45_000 }))
  const pairingState = await readExtensionPairingStorage(worker)
  const grants = parsedExtensionPairingSessionGrants(
    Object.entries(pairingState),
  )
  return worker.evaluate(async (pairedGrants) => {
    await new Promise<unknown>((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: 'nook:ensure-extension-session-runtime' },
        resolve,
      )
    })
    const accounts: Array<{ issuer: string; account: string }> = []
    for (const grant of pairedGrants) {
      const response = (await new Promise<unknown>((resolve) => {
        globalThis.chrome.runtime.sendMessage(
          {
            type: 'nook:extension-session-list-authenticators',
            payload: {
              ...grant,
              query: '',
              queue: { kind: 'message-default' },
            },
          },
          resolve,
        )
      })) as {
        ok?: boolean
        accounts?: Array<{ issuer?: string; account?: string }>
      }
      if (!response?.ok || !Array.isArray(response.accounts)) continue
      for (const account of response.accounts) {
        if (
          typeof account.issuer === 'string' &&
          typeof account.account === 'string'
        ) {
          accounts.push({ issuer: account.issuer, account: account.account })
        }
      }
    }
    return accounts
  }, grants)
}

type MalformedBackupCodeReplaceAttemptArgs = {
  context: Awaited<ReturnType<typeof launchPairedPinExtension>>['context']
  account: string
}

type MalformedBackupCodeReplaceResponse = {
  ok: false
  error: string
}

type MalformedBackupCodeReplaceResult = {
  response: MalformedBackupCodeReplaceResponse
  beforeEventLog: EventLogSnapshot
  afterEventLog: EventLogSnapshot
}

type EventLogSnapshot = {
  digest: string
  entryCount: number
}

async function attemptMalformedBackupCodeReplace(
  args: MalformedBackupCodeReplaceAttemptArgs,
): Promise<MalformedBackupCodeReplaceResult> {
  const worker =
    args.context.serviceWorkers()[0] ??
    (await args.context.waitForEvent('serviceworker', { timeout: 45_000 }))
  const pairingState = await readExtensionPairingStorage(worker)
  const grants = parsedExtensionPairingSessionGrants(
    Object.entries(pairingState),
  )
  const evaluateArgs = {
    grants,
    account: args.account,
    listType: ExtensionSessionMessageType.ListAuthenticators,
    attachType: ExtensionSessionMessageType.AuthenticatorBackupAttach,
    replaceMode: WebsiteAuthenticatorBackupAttachMessageMode.Replace,
    queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  }
  return worker.evaluate(async (input) => {
    type AuthenticatorAccount = {
      secretId: string
      account: string
    }
    type AuthenticatorListResponse = {
      ok?: boolean
      accounts?: AuthenticatorAccount[]
    }
    const sendMessage = <Response>(message: unknown) =>
      new Promise<Response>((resolve) => {
        globalThis.chrome.runtime.sendMessage(message, resolve)
      })
    enum DatabaseOpenResultKind {
      Opened = 'opened',
      Failed = 'failed',
    }
    type DatabaseOpenResult =
      | { kind: DatabaseOpenResultKind.Opened; database: IDBDatabase }
      | { kind: DatabaseOpenResultKind.Failed; message: string }
    enum EventLogReadResultKind {
      Read = 'read',
      Failed = 'failed',
    }
    type EventLogReadResult =
      | { kind: EventLogReadResultKind.Read; entries: string[] }
      | { kind: EventLogReadResultKind.Failed; message: string }
    const eventLogSnapshot = async (
      vaultStoreId: string,
    ): Promise<EventLogSnapshot> => {
      const databaseRequest = globalThis.indexedDB.open('nook_db')
      const databaseResult = await new Promise<DatabaseOpenResult>(
        (resolve) => {
          databaseRequest.onsuccess = () => {
            resolve({
              kind: DatabaseOpenResultKind.Opened,
              database: databaseRequest.result,
            })
          }
          databaseRequest.onerror = () => {
            resolve({
              kind: DatabaseOpenResultKind.Failed,
              message:
                databaseRequest.error?.message ??
                'Failed to open extension event storage.',
            })
          }
        },
      )
      if (databaseResult.kind === DatabaseOpenResultKind.Failed) {
        throw new Error(databaseResult.message)
      }
      const database = databaseResult.database
      const transaction = database.transaction('events', 'readonly')
      const cursorRequest = transaction.objectStore('events').openCursor()
      const eventPrefix = `event:${vaultStoreId}:`
      const eventIndexKey = `event_index:${vaultStoreId}`
      const readResult = await new Promise<EventLogReadResult>((resolve) => {
        const entries: string[] = []
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) {
            resolve({ kind: EventLogReadResultKind.Read, entries })
            return
          }
          if (
            typeof cursor.key !== 'string' ||
            typeof cursor.value !== 'string'
          ) {
            resolve({
              kind: EventLogReadResultKind.Failed,
              message: 'Extension event storage contained an invalid row.',
            })
            return
          }
          if (
            cursor.key.startsWith(eventPrefix) ||
            cursor.key === eventIndexKey
          ) {
            entries.push(`${cursor.key}\u0000${cursor.value}`)
          }
          cursor.continue()
        }
        cursorRequest.onerror = () => {
          resolve({
            kind: EventLogReadResultKind.Failed,
            message:
              cursorRequest.error?.message ??
              'Failed to read extension event storage.',
          })
        }
      })
      database.close()
      if (readResult.kind === EventLogReadResultKind.Failed) {
        throw new Error(readResult.message)
      }
      const encoded = new TextEncoder().encode(
        readResult.entries.join('\u0000'),
      )
      const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
      return {
        digest: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
        entryCount: readResult.entries.length,
      }
    }

    for (const grant of input.grants) {
      const listRequest = {
        type: input.listType,
        payload: { ...grant, query: '', queue: input.queue },
      }
      const listed = await sendMessage<AuthenticatorListResponse>(listRequest)
      const authenticator = listed.accounts?.find(
        (candidate) => candidate.account === input.account,
      )
      if (!authenticator) continue
      const malformedReplaceRequest = {
        type: input.attachType,
        payload: {
          ...grant,
          secretId: authenticator.secretId,
          codes: { malformed: true },
          mode: input.replaceMode,
          queue: input.queue,
        },
      }
      const beforeEventLog = await eventLogSnapshot(grant.vaultStoreId)
      const response = await sendMessage<MalformedBackupCodeReplaceResponse>(
        malformedReplaceRequest,
      )
      const afterEventLog = await eventLogSnapshot(grant.vaultStoreId)
      return {
        response,
        beforeEventLog,
        afterEventLog,
      }
    }
    throw new Error('Expected the enrolled authenticator in the paired vault.')
  }, evaluateArgs)
}

test.describe('Browser 2FA enrollment', () => {
  test.describe.configure({ timeout: 180_000 })

  test('cancels QR preview without vault write', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Enrollment QR cancel vault',
    })
    try {
      const enrollPage = await paired.context.newPage()
      await enrollPage.goto(`${mockAuth.origin}/totp/enroll`)
      await expect(enrollPage.getByTestId('mock-auth-totp-qr')).toBeVisible()

      const widget = enrollPage.locator('#nook-auth-widget')
      await expect(
        widget.getByRole('button', { name: 'Add 2FA from this page' }),
      ).toBeVisible({ timeout: 15_000 })

      await widget
        .getByRole('button', { name: 'Add 2FA from this page' })
        .click()
      await expect(
        widget.getByRole('heading', {
          name: /Review this authenticator before continuing/,
        }),
      ).toBeVisible({ timeout: 20_000 })
      await expect(widget.getByText(/Service:/)).toBeVisible()
      await expect(widget.getByText(/Account:/)).toBeVisible()
      await expect(widget.getByText(mockAuth.origin)).toBeVisible()
      await expect(widget.getByText(/JBSWY3DPEHPK3PXP/)).toHaveCount(0)

      await widget.getByRole('button', { name: 'Cancel' }).click()
      await expect(
        widget.getByRole('button', { name: 'Add 2FA from this page' }),
      ).toBeVisible()
      expect(await listExtensionAuthenticators(paired.context)).toEqual([])
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('stages QR, fills verify, encrypts only after Sufficient evidence', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Enrollment ceremony vault',
    })
    try {
      const enrollPage = await paired.context.newPage()
      await enrollPage.goto(`${mockAuth.origin}/totp/enroll`)
      const widget = enrollPage.locator('#nook-auth-widget')
      await expect(
        widget.getByRole('button', { name: 'Add 2FA from this page' }),
      ).toBeVisible({ timeout: 15_000 })

      await widget
        .getByRole('button', { name: 'Add 2FA from this page' })
        .click()
      await expect(
        widget.getByRole('button', { name: 'Continue enrollment' }),
      ).toBeVisible({ timeout: 20_000 })
      await widget.getByRole('button', { name: 'Continue enrollment' }).click()
      await expect(
        widget.getByText(/Verification code filled|Complete verification/i),
      ).toBeVisible({ timeout: 20_000 })
      expect(await listExtensionAuthenticators(paired.context)).toEqual([])

      await enrollPage.getByTestId('mock-auth-enroll-continue-verify').click()
      await expect(
        enrollPage.getByTestId('mock-auth-enroll-otp-input'),
      ).toBeVisible({ timeout: 10_000 })
      await expect(
        enrollPage.getByTestId('mock-auth-enroll-otp-input'),
      ).toHaveValue(/^\d{6}$/, { timeout: 15_000 })

      await enrollPage.getByRole('button', { name: 'Verify' }).click()
      await expect(enrollPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(
        widget.getByText('Authenticator saved to your vault.'),
      ).toBeVisible({ timeout: 20_000 })

      await expect
        .poll(async () => listExtensionAuthenticators(paired.context), {
          timeout: 15_000,
        })
        .toEqual([
          {
            issuer: 'Mock Auth',
            account: 'alice-2fa@nook.test',
          },
        ])

      const otpPage = await paired.context.newPage()
      await otpPage.goto(`${mockAuth.origin}/otp`)
      const otpWidget = otpPage.locator('#nook-auth-widget')
      const authenticatorPickerPromise = paired.context.waitForEvent('page')
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      const authenticatorPicker = await authenticatorPickerPromise
      await authenticatorPicker.waitForURL(/intent=authenticator-picker/)
      await authenticatorPicker
        .getByRole('button', { name: /Mock Auth/ })
        .click()
      await expect(
        otpPage.locator('[autocomplete="one-time-code"]'),
      ).toHaveValue(/^\d{6}$/)
      await expect.poll(() => authenticatorPicker.isClosed()).toBe(true)
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('reviews backup codes with replace semantics and no automatic save', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Enrollment backup vault',
    })
    try {
      const enrollPage = await paired.context.newPage()
      await enrollPage.goto(`${mockAuth.origin}/totp/enroll`)
      const enrollWidget = enrollPage.locator('#nook-auth-widget')
      await expect(
        enrollWidget.getByRole('button', { name: 'Add 2FA from this page' }),
      ).toBeVisible({ timeout: 15_000 })
      await enrollWidget
        .getByRole('button', { name: 'Add 2FA from this page' })
        .click()
      await expect(
        enrollWidget.getByRole('button', { name: 'Continue enrollment' }),
      ).toBeVisible({ timeout: 20_000 })
      await enrollWidget
        .getByRole('button', { name: 'Continue enrollment' })
        .click()
      await expect(
        enrollWidget.getByText(
          /Verification code filled|Complete verification/i,
        ),
      ).toBeVisible({ timeout: 20_000 })
      await enrollPage.getByTestId('mock-auth-enroll-continue-verify').click()
      await expect(
        enrollPage.getByTestId('mock-auth-enroll-otp-input'),
      ).toHaveValue(/^\d{6}$/, { timeout: 15_000 })
      await enrollPage.getByRole('button', { name: 'Verify' }).click()
      await expect(enrollPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(
        enrollWidget.getByText('Authenticator saved to your vault.'),
      ).toBeVisible({ timeout: 20_000 })
      await expect
        .poll(async () => listExtensionAuthenticators(paired.context), {
          timeout: 15_000,
        })
        .toEqual([
          {
            issuer: 'Mock Auth',
            account: 'alice-2fa@nook.test',
          },
        ])

      const backupPage = await paired.context.newPage()
      await backupPage.goto(`${mockAuth.origin}/totp/backup-codes`)
      const widget = backupPage.locator('#nook-auth-widget')
      await expect(
        widget.getByRole('button', { name: 'Save backup codes' }),
      ).toBeVisible({ timeout: 15_000 })

      // CTA opens the review UI; the confirm control reuses the same label.
      await widget.getByRole('button', { name: 'Save backup codes' }).click()
      const reviewedCodes = widget.locator('.account-list label span')
      await expect(reviewedCodes).toHaveText([
        'A1B2-C3D4-E5F6',
        'G7H8-I9J0-K1L2',
      ])
      await widget.getByRole('button', { name: 'Save backup codes' }).click()

      const replaceButton = widget.getByRole('button', {
        name: 'Replace existing codes',
      })
      const authenticatorChoice = widget.getByRole('button', {
        name: 'Saved 2FA 1',
      })
      await expect(replaceButton.or(authenticatorChoice)).toBeVisible({
        timeout: 15_000,
      })
      if (await authenticatorChoice.isVisible()) {
        await authenticatorChoice.click()
      }
      await expect(replaceButton).toBeVisible({ timeout: 15_000 })
      await expect(
        widget.getByRole('button', { name: 'Save backup codes' }),
      ).toHaveCount(0)

      await replaceButton.click()
      await expect(
        widget.getByText(/backup codes saved|резервные коды сохранены/i),
      ).toBeVisible({ timeout: 20_000 })

      const malformedReplaceArgs: MalformedBackupCodeReplaceAttemptArgs = {
        context: paired.context,
        account: 'alice-2fa@nook.test',
      }
      const malformedReplaceResult =
        await attemptMalformedBackupCodeReplace(malformedReplaceArgs)
      expect(malformedReplaceResult.response).toEqual({
        ok: false,
        error: 'Invalid extension session request.',
      })
      // The extension is intentionally not a vault-management UI and cannot
      // reveal backup codes. Compare the immutable encrypted event source of
      // truth instead: any replacement changes its exact digest.
      expect(malformedReplaceResult.beforeEventLog.entryCount).toBeGreaterThan(
        0,
      )
      expect(malformedReplaceResult.afterEventLog).toEqual(
        malformedReplaceResult.beforeEventLog,
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
