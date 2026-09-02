import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import {
  EnrollmentAuthorizeOutcome,
  EnrollmentRevokeOutcome,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
let revokeOutcome = EnrollmentRevokeOutcome.Missing
let authorizeEnrollment: () => Promise<boolean> = async () => true
let authorizationStarted = () => {}
let stagedCodeDelivery = async () => ({
  ok: true,
  code: '123456',
  expiresAt: Date.now() + 30_000,
})
type SessionRequest = { type: string; payload: Record<string, unknown> }
const authorizedStageIds: string[] = []
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
        return {
          ok: true,
          outcome: (await authorizeEnrollment())
            ? EnrollmentAuthorizeOutcome.Authorized
            : EnrollmentAuthorizeOutcome.Invalid,
        }
      }
      if (type.endsWith('revoke')) {
        return { ok: true, outcome: revokeOutcome }
      }
      if (type.endsWith('enroll-code')) {
        stagedCodeUris.push(payload.otpauthUri as string)
        return stagedCodeDelivery()
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
  expect(request).resolves.toEqual(expect.objectContaining({ ok: true }))
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
async function expectDeferredCodeRejected(
  stageId: string,
  invalidate: () => unknown,
) {
  expect(await stage(stageId)).toEqual({ ok: true, stageId })
  const delivery = Promise.withResolvers<{
    ok: true
    code: string
    expiresAt: number
  }>()
  stagedCodeDelivery = () => delivery.promise
  const request = ops.websiteAuthenticatorEnrollCode(dismissArgs(stageId))
  await Promise.resolve()
  await invalidate()
  const response = {
    ok: true as const,
    code: '654321',
    expiresAt: Date.now() + 30_000,
  }
  delivery.resolve(response)
  await expectReason(request, missing)
  expect(response.code).toBe('')
}
test('cancel before stage delivery prevents authorization', async () => {
  await expectOk(dismiss('before-delivery'))
  authorizedStageIds.length = 0
  await expectReason(stage('before-delivery'), missing)
  expect(authorizedStageIds).toEqual([])
  authorizeEnrollment = () => Promise.reject(new Error('offscreen lost'))
  await expect(stage('lost-offscreen')).rejects.toThrow('offscreen lost')
  authorizeEnrollment = async () => true
  await expectOk(stage('after-loss'))
  await expectOk(dismiss('after-loss'))
})
test('staged enrollment cancel during authorization prevents staging', async () => {
  revokeOutcome = EnrollmentRevokeOutcome.Missing
  authorizedStageIds.length = 0
  const [started, release] = deferAuthorization(true)
  const staging = stage('during')
  await started
  await expectOk(dismiss('during'))
  release()
  await expectReason(staging, missing)
})
test('same-origin staging lease rejects a second request before authorization resolves', async () => {
  authorizedStageIds.length = 0
  const [started, release] = deferAuthorization(true)
  const first = stage('origin-lease-first')
  await started
  authorizedOrigin = 'https://foreign.example.test'
  await expectOk(dismiss('origin-lease-first', authorizedOrigin))
  authorizedOrigin = origin
  await expectReason(stage('origin-lease-second'), missing)
  expect(authorizedStageIds).toEqual(['origin-lease-first'])
  release()
  await expectOk(first)
  revokeOutcome = EnrollmentRevokeOutcome.Revoked
  await expectOk(dismiss('origin-lease-first'))
})
test('failed revoke retains staged URI for retry', async () => {
  authorizeEnrollment = async () => true
  authorizationStarted = () => {}
  revokeOutcome = EnrollmentRevokeOutcome.Committing
  expect(await stage('retry')).toEqual({ ok: true, stageId: 'retry' })
  await expectOk(dismiss('retry'))
  await ops.websiteAuthenticatorEnrollCode(dismissArgs('retry'))
  expect(stagedCodeUris.at(-1)).toContain('secret=JBSWY3DPEHPK3PXP')
  revokeOutcome = EnrollmentRevokeOutcome.Revoked
  await expectOk(dismiss('retry'))
})
test('staged enrollment full tombstones preserve origin isolation', async () => {
  revokeOutcome = EnrollmentRevokeOutcome.Missing
  const capacityOrigin = origin
  authorizedOrigin = capacityOrigin
  for (let index = 0; index < 128; index += 1)
    await expectOk(dismiss(`capacity-${index}`, capacityOrigin))
  const [started, release] = deferAuthorization(true)
  const staging = stage('capacity-pending')
  await started
  await expectReason(
    dismiss('capacity-pending', capacityOrigin),
    'authenticator-retry-required',
  )
  release()
  await expectReason(staging, missing)
  authorizedOrigin = 'https://isolated.example.test'
  await expectOk(dismiss('isolated-stage', authorizedOrigin))
  authorizedOrigin = origin
})
test('code returned after exact stage ownership is revoked is scrubbed', async () => {
  authorizeEnrollment = async () => true
  revokeOutcome = EnrollmentRevokeOutcome.Revoked
  await expectDeferredCodeRejected('code-race', () => dismiss('code-race'))
})
test('code crossing its actual staged TTL while deferred is scrubbed', async () => {
  const nativeNow = Date.now
  const nativeTimeout = globalThis.setTimeout
  let expire = () => {}
  let now = nativeNow()
  Date.now = () => now
  globalThis.setTimeout = ((callback: TimerHandler) => {
    expire = callback as () => void
    return 1
  }) as typeof setTimeout
  try {
    await expectDeferredCodeRejected('ttl-code', () => {
      now += 5 * 60 * 1_000 + 1
    })
    expect(await stage('timer')).toEqual({ ok: true, stageId: 'timer' })
    expire()
    expect(await pending()).toEqual({ ok: true })
  } finally {
    Date.now = nativeNow
    globalThis.setTimeout = nativeTimeout
  }
})
