import { describe, expect, mock, test } from 'bun:test'

let revokeAccepted = true
let authorizeEnrollment: () => Promise<boolean> = async () => true
let authorizationStarted = () => {}
const authorizedStageIds: string[] = []
const revokedStageIds: string[] = []
const stagedCodeUris: string[] = []
let authorizedOrigin = 'https://example.test'

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
  isAuthorizedWebsiteSender: ({ origin }: { origin: string }) =>
    origin === authorizedOrigin,
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
    authorizeAuthenticatorEnrollmentFromSession: async ({
      enrollmentAuthorizationId,
    }: {
      enrollmentAuthorizationId: string
    }) => {
      authorizedStageIds.push(enrollmentAuthorizationId)
      authorizationStarted()
      return authorizeEnrollment()
    },
    authenticatorCodeFromSession: async () => ({ ok: true }),
    authenticatorPreviewFromSession: async () => ({ ok: true }),
    confirmAuthenticatorEnrollment: async () => ({ ok: true }),
    revokeAuthenticatorEnrollmentFromSession: async (stageId: string) => {
      revokedStageIds.push(stageId)
      return revokeAccepted
    },
    selectedAuthenticatorPageAcknowledged: async () => true,
    stagedAuthenticatorCodeFromSession: async (otpauthUri: string) => {
      stagedCodeUris.push(otpauthUri)
      return { ok: true }
    },
  }),
)

const sender = {} as chrome.runtime.MessageSender
const origin = 'https://example.test'

function stageArgs(stageId: string) {
  return {
    message: {
      payload: {
        origin,
        stageId,
        vaultStoreId: 'vault-1',
        otpauthUri:
          'otpauth://totp/Nook:test?secret=JBSWY3DPEHPK3PXP&issuer=Nook',
      },
    },
    sender,
  }
}

function dismissArgs(stageId: string) {
  return { message: { payload: { origin, stageId } }, sender }
}

const pendingArgs = { message: { payload: { origin } }, sender }

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
      const stage = await websiteAuthenticatorEnrollStage(
        stageArgs('stage-ttl'),
      )
      expect(stage.ok).toBe(true)

      expire()

      await expect(
        websiteAuthenticatorEnrollPending(pendingArgs),
      ).resolves.toEqual({ ok: true })
    } finally {
      globalThis.setTimeout = nativeSetTimeout
    }
  })

  test('cancel before stage delivery prevents authorization and staging', async () => {
    revokeAccepted = false
    authorizedStageIds.length = 0
    const {
      websiteAuthenticatorEnrollDismiss,
      websiteAuthenticatorEnrollPending,
      websiteAuthenticatorEnrollStage,
    } =
      await import('../src/background/service-worker/authenticator-operations')
    const dismissal = dismissArgs('stage-before-delivery')
    await expect(websiteAuthenticatorEnrollDismiss(dismissal)).resolves.toEqual(
      { ok: true },
    )
    await expect(websiteAuthenticatorEnrollDismiss(dismissal)).resolves.toEqual(
      { ok: true },
    )
    const response = await websiteAuthenticatorEnrollStage(
      stageArgs('stage-before-delivery'),
    )
    expect(response).toEqual({
      ok: false,
      reason: 'authenticator-stage-missing',
    })
    expect(authorizedStageIds).toEqual([])
    await expect(
      websiteAuthenticatorEnrollPending(pendingArgs),
    ).resolves.toEqual({ ok: true })
  })

  test('cancel during authorization revokes and prevents late staging', async () => {
    revokeAccepted = true
    authorizedStageIds.length = 0
    revokedStageIds.length = 0
    let markAuthorizationStarted = () => {}
    const authorizationStartedPromise = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve
    })
    authorizationStarted = markAuthorizationStarted
    let releaseAuthorization = () => {
      throw new Error('authorization was not pending')
    }
    authorizeEnrollment = () =>
      new Promise<boolean>((resolve) => {
        releaseAuthorization = () => resolve(true)
      })
    const {
      websiteAuthenticatorEnrollDismiss,
      websiteAuthenticatorEnrollPending,
      websiteAuthenticatorEnrollStage,
    } =
      await import('../src/background/service-worker/authenticator-operations')
    const stageId = 'stage-during-authorization'
    const staging = websiteAuthenticatorEnrollStage(stageArgs(stageId))
    await authorizationStartedPromise
    expect(authorizedStageIds).toEqual([stageId])
    await expect(
      websiteAuthenticatorEnrollDismiss(dismissArgs(stageId)),
    ).resolves.toEqual({ ok: true })
    releaseAuthorization()
    await expect(staging).resolves.toEqual({
      ok: false,
      reason: 'authenticator-stage-missing',
    })
    expect(revokedStageIds).toContain(stageId)
    await expect(
      websiteAuthenticatorEnrollPending(pendingArgs),
    ).resolves.toEqual({ ok: true })
  })

  test('foreign-origin dismissal cannot revoke a pending stage', async () => {
    revokeAccepted = true
    revokedStageIds.length = 0
    let markAuthorizationStarted = () => {}
    const authorizationStartedPromise = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve
    })
    authorizationStarted = markAuthorizationStarted
    let releaseAuthorization = () => {}
    authorizeEnrollment = () =>
      new Promise<boolean>((resolve) => {
        releaseAuthorization = () => resolve(false)
      })
    const {
      websiteAuthenticatorEnrollDismiss,
      websiteAuthenticatorEnrollStage,
    } =
      await import('../src/background/service-worker/authenticator-operations')
    const stageId = 'stage-origin-bound'
    const staging = websiteAuthenticatorEnrollStage(stageArgs(stageId))
    await authorizationStartedPromise
    authorizedOrigin = 'https://foreign.example.test'
    await expect(
      websiteAuthenticatorEnrollDismiss({
        message: { payload: { origin: authorizedOrigin, stageId } },
        sender,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'authenticator-stage-missing',
    })
    expect(revokedStageIds).toEqual([])
    authorizedOrigin = origin
    releaseAuthorization()
    await staging
  })

  test('failed staged revoke retains the URI for retry', async () => {
    authorizeEnrollment = async () => true
    authorizationStarted = () => {}
    revokeAccepted = false
    stagedCodeUris.length = 0
    const {
      websiteAuthenticatorEnrollCode,
      websiteAuthenticatorEnrollDismiss,
      websiteAuthenticatorEnrollStage,
    } =
      await import('../src/background/service-worker/authenticator-operations')
    const stageId = 'stage-revoke-retry'
    await expect(
      websiteAuthenticatorEnrollStage(stageArgs(stageId)),
    ).resolves.toEqual({ ok: true, stageId })
    await expect(
      websiteAuthenticatorEnrollDismiss(dismissArgs(stageId)),
    ).resolves.toEqual({
      ok: false,
      reason: 'authenticator-enroll-failed',
    })
    await websiteAuthenticatorEnrollCode({
      message: { payload: { origin, stageId } },
      sender,
    })
    expect(stagedCodeUris.at(-1)).toContain('secret=JBSWY3DPEHPK3PXP')
    revokeAccepted = true
    await expect(
      websiteAuthenticatorEnrollDismiss(dismissArgs(stageId)),
    ).resolves.toEqual({ ok: true })
  })

  test('full origin tombstones fail truthfully without blocking another origin', async () => {
    revokeAccepted = false
    const { websiteAuthenticatorEnrollDismiss } =
      await import('../src/background/service-worker/authenticator-operations')
    const capacityOrigin = 'https://capacity.example.test'
    authorizedOrigin = capacityOrigin
    for (let index = 0; index < 128; index += 1) {
      await expect(
        websiteAuthenticatorEnrollDismiss({
          message: {
            payload: { origin: capacityOrigin, stageId: `capacity-${index}` },
          },
          sender,
        }),
      ).resolves.toEqual({ ok: true })
    }
    await expect(
      websiteAuthenticatorEnrollDismiss({
        message: {
          payload: { origin: capacityOrigin, stageId: 'capacity-overflow' },
        },
        sender,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'authenticator-enroll-failed',
    })
    const isolatedOrigin = 'https://isolated.example.test'
    authorizedOrigin = isolatedOrigin
    await expect(
      websiteAuthenticatorEnrollDismiss({
        message: {
          payload: { origin: isolatedOrigin, stageId: 'isolated-stage' },
        },
        sender,
      }),
    ).resolves.toEqual({ ok: true })
    authorizedOrigin = origin
  })
})
