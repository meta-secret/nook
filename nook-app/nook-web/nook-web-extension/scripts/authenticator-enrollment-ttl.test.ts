import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
let revokeAccepted = true
let authorizeEnrollment: () => Promise<boolean> = async () => true
let authorizationStarted = () => {}
type SessionRequest = { type: string; payload: Record<string, unknown> }
const authorizedStageIds: string[] = []
const revokedStageIds: string[] = []
const stagedCodeUris: string[] = []
let authorizedOrigin = 'https://example.test'
let ops: typeof import('../src/background/service-worker/authenticator-operations')
beforeAll(async () => {
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
    sendSessionMessage: async ({ type, payload }: SessionRequest) => {
      if (type.endsWith('authorize')) {
        authorizedStageIds.push(payload.enrollmentAuthorizationId as string)
        authorizationStarted()
        return { ok: true, accepted: await authorizeEnrollment() }
      }
      if (type.endsWith('revoke')) {
        revokedStageIds.push(payload.enrollmentAuthorizationId as string)
        return { ok: true, accepted: revokeAccepted }
      }
      if (type.endsWith('enroll-code')) {
        stagedCodeUris.push(payload.otpauthUri as string)
        return { ok: true, code: '123456', expiresAt: Date.now() + 30_000 }
      }
      return new Promise((resolve) =>
        chrome.runtime.sendMessage({ type, payload }, resolve),
      )
    },
  }))
  mock.module('../src/background/service-worker/session-lifecycle', () => ({
    ensureExtensionSessionDocument: async () => {},
  }))
  ops =
    await import('../src/background/service-worker/authenticator-operations')
})
const sender = {} as chrome.runtime.MessageSender
const origin = 'https://example.test'
const uri = 'otpauth://totp/Nook:test?secret=JBSWY3DPEHPK3PXP&issuer=Nook'
const missing = 'authenticator-stage-missing'
const failed = 'authenticator-enroll-failed'
const stageArgs = (stageId: string) => ({
  message: {
    payload: { origin, stageId, vaultStoreId: 'vault-1', otpauthUri: uri },
  },
  sender,
})
const dismissArgs = (stageId: string, requestOrigin = origin) => ({
  message: { payload: { origin: requestOrigin, stageId } },
  sender,
})
const pendingArgs = { message: { payload: { origin } }, sender }
const dismiss = (stageId: string, requestOrigin = origin) =>
  ops.websiteAuthenticatorEnrollDismiss(dismissArgs(stageId, requestOrigin))
const pending = () => ops.websiteAuthenticatorEnrollPending(pendingArgs)
const stage = (stageId: string) =>
  ops.websiteAuthenticatorEnrollStage(stageArgs(stageId))
const expectOk = (request: Promise<unknown>) =>
  expect(request).resolves.toEqual({ ok: true })
const expectReason = (request: Promise<unknown>, reason: string) =>
  expect(request).resolves.toEqual({ ok: false, reason })
afterAll(() => mock.restore())
function deferAuthorization(result: boolean) {
  const authorization = Promise.withResolvers<boolean>()
  const started = Promise.withResolvers<void>()
  authorizationStarted = started.resolve
  authorizeEnrollment = () => authorization.promise
  return [started.promise, () => authorization.resolve(result)] as const
}
test('staged enrollment TTL clears the URI without follow-up traffic', async () => {
  const nativeSetTimeout = globalThis.setTimeout
  let expire = () => {}
  globalThis.setTimeout = ((callback: TimerHandler, timeout?: number) => {
    if (typeof callback === 'function' && timeout && timeout > 290_000) {
      expire = callback
      return 1
    }
    return nativeSetTimeout(callback, timeout)
  }) as typeof setTimeout
  try {
    expect((await stage('ttl')).ok).toBe(true)
    expire()
    await expectOk(pending())
  } finally {
    globalThis.setTimeout = nativeSetTimeout
  }
})
test('staged enrollment cancel before delivery prevents staging', async () => {
  revokeAccepted = false
  authorizedStageIds.length = 0
  await expectOk(dismiss('before-delivery'))
  await expectOk(dismiss('before-delivery'))
  await expectReason(stage('before-delivery'), missing)
  expect(authorizedStageIds).toEqual([])
  await expectOk(pending())
})
test('staged enrollment cancel during authorization prevents staging', async () => {
  revokeAccepted = true
  authorizedStageIds.length = 0
  revokedStageIds.length = 0
  const [started, release] = deferAuthorization(true)
  const staging = stage('during')
  await started
  expect(authorizedStageIds).toEqual(['during'])
  await expectOk(dismiss('during'))
  release()
  await expectReason(staging, missing)
  expect(revokedStageIds).toContain('during')
  await expectOk(pending())
})
test('staged enrollment foreign-origin dismissal cannot revoke pending', async () => {
  revokeAccepted = true
  revokedStageIds.length = 0
  const [started, release] = deferAuthorization(false)
  const staging = stage('origin')
  await started
  authorizedOrigin = 'https://foreign.example.test'
  await expectReason(dismiss('origin', authorizedOrigin), missing)
  expect(revokedStageIds).toEqual([])
  authorizedOrigin = origin
  release()
  await staging
})
test('staged enrollment failed revoke retains the URI for retry', async () => {
  authorizeEnrollment = async () => true
  authorizationStarted = () => {}
  revokeAccepted = false
  stagedCodeUris.length = 0
  expect(await stage('retry')).toEqual({ ok: true, stageId: 'retry' })
  await expectReason(dismiss('retry'), failed)
  await ops.websiteAuthenticatorEnrollCode(dismissArgs('retry'))
  expect(stagedCodeUris.at(-1)).toContain('secret=JBSWY3DPEHPK3PXP')
  revokeAccepted = true
  await expectOk(dismiss('retry'))
})
test('staged enrollment full tombstones preserve origin isolation', async () => {
  revokeAccepted = false
  const capacityOrigin = 'https://capacity.example.test'
  authorizedOrigin = capacityOrigin
  for (let index = 0; index < 128; index += 1)
    await expectOk(dismiss(`capacity-${index}`, capacityOrigin))
  await expectReason(dismiss('capacity-overflow', capacityOrigin), failed)
  authorizedOrigin = 'https://isolated.example.test'
  await expectOk(dismiss('isolated-stage', authorizedOrigin))
  authorizedOrigin = origin
})
