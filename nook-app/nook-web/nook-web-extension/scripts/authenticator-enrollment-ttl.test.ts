import { describe, expect, mock, test } from 'bun:test'

let revokeAccepted = true

mock.module('../src/background/service-worker/account-pickers', () => ({
  AccountPickerSurfaceKind: {},
  AuthenticatorPickerLoadKind: {},
  AUTHENTICATOR_PICKER_TTL_MS: 30_000,
  accountPickerAuthorizationGeneration: async () => 'generation-1',
  accountPickerAuthorizationCleanupPending: () => false,
  accountPickerAuthorizationIsCurrent: () => true,
  authenticatorAccounts: async () => [],
  authorizedWebsiteGrant: async () => ({ grant: {} }),
  closeAccountPickerSurface: () => {},
  emptyAccountPickerSurface: () => ({}),
  isAuthenticatorPickerSender: () => true,
  loadAuthenticatorPicker: async () => ({}),
  removeAuthenticatorPicker: async () => {},
  storeAuthenticatorPicker: async () => {},
}))

mock.module('../src/background/service-worker/pairing-identity', () => ({
  availableWebsiteGrants: async () => [],
  isAuthorizedWebsiteSender: () => true,
  passwordPairingGrants: async () => [],
  randomNonce: () => 'nonce-1',
}))

mock.module('../src/background/service-worker/session-lifecycle', () => ({
  ensureExtensionSessionDocument: async () => {},
}))

mock.module(
  '../src/background/service-worker/authenticator-session-adapter',
  () => ({
    attachAuthenticatorBackupCodesFromSession: async () => ({ ok: true }),
    authorizeAuthenticatorEnrollmentFromSession: async () => true,
    authenticatorCodeFromSession: async () => ({ ok: true }),
    authenticatorPreviewFromSession: async () => ({ ok: true }),
    confirmAuthenticatorEnrollment: async () => ({ ok: true }),
    revokeAuthenticatorEnrollmentFromSession: async () => revokeAccepted,
    selectedAuthenticatorPageAcknowledged: async () => true,
    stagedAuthenticatorCodeFromSession: async () => ({ ok: true }),
  }),
)

describe('staged authenticator enrollment expiry', () => {
  test('scheduled TTL clears the staged URI without follow-up traffic', async () => {
    const nativeSetTimeout = globalThis.setTimeout
    let expire = () => {
      throw new Error('staged enrollment expiry was not scheduled')
    }
    globalThis.setTimeout = ((callback: TimerHandler, timeout?: number) => {
      if (typeof callback === 'function' && timeout && timeout > 290_000) {
        expire = callback
        return 1
      }
      return nativeSetTimeout(callback, timeout)
    }) as typeof setTimeout
    try {
      const {
        websiteAuthenticatorEnrollPending,
        websiteAuthenticatorEnrollStage,
      } =
        await import('../src/background/service-worker/authenticator-operations')
      const sender = {} as chrome.runtime.MessageSender
      const stage = await websiteAuthenticatorEnrollStage({
        message: {
          payload: {
            origin: 'https://example.test',
            vaultStoreId: 'vault-1',
            otpauthUri:
              'otpauth://totp/Nook:test?secret=JBSWY3DPEHPK3PXP&issuer=Nook',
          },
        },
        sender,
      })
      expect(stage.ok).toBe(true)

      expire()

      await expect(
        websiteAuthenticatorEnrollPending({
          message: { payload: { origin: 'https://example.test' } },
          sender,
        }),
      ).resolves.toEqual({ ok: true })
    } finally {
      globalThis.setTimeout = nativeSetTimeout
    }
  })

  test('dismissal fails when offscreen authorization is missing', async () => {
    revokeAccepted = false
    const { websiteAuthenticatorEnrollDismiss } =
      await import('../src/background/service-worker/authenticator-operations')
    await expect(
      websiteAuthenticatorEnrollDismiss({
        message: {
          payload: {
            origin: 'https://example.test',
            stageId: 'committed-or-missing-stage',
          },
        },
        sender: {} as chrome.runtime.MessageSender,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'authenticator-enroll-failed',
    })
  })
})
