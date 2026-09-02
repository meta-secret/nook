import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
// prettier-ignore
import { EnrollmentAuthorizeOutcome, EnrollmentRevokeOutcome } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

type Code = { ok: true; code: string; expiresAt: number }
type SessionRequest = { type: string; payload: Record<string, unknown> }
let revokeOutcome = EnrollmentRevokeOutcome.Missing
let authorizeEnrollment: () => Promise<boolean> = async () => true
let authorizationStarted = () => {}
// prettier-ignore
let stagedCodeDelivery: () => Promise<Code> = async () => ({ ok: true, code: '123456', expiresAt: Date.now() + 30_000 })
const authorizedStageIds: string[] = []
const stagedCodeUris: string[] = []
let authorizedOrigin = 'https://example.test'
let ops: typeof import('../src/background/service-worker/authenticator-operations')

async function sendSessionMessage({ type, payload }: SessionRequest) {
  if (type.endsWith('authorize')) {
    authorizedStageIds.push(payload.enrollmentAuthorizationId as string)
    authorizationStarted()
    // prettier-ignore
    return { ok: true, outcome: (await authorizeEnrollment()) ? EnrollmentAuthorizeOutcome.Authorized : EnrollmentAuthorizeOutcome.Invalid }
  }
  if (type.endsWith('revoke')) return { ok: true, outcome: revokeOutcome }
  if (type.endsWith('enroll-code')) {
    stagedCodeUris.push(payload.otpauthUri as string)
    return stagedCodeDelivery()
  }
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, payload }, resolve),
  )
}

beforeAll(async () => {
  // prettier-ignore
  mock.module('../src/background/service-worker/account-pickers', () => ({ AccountPickerSurfaceKind: {}, AuthenticatorPickerLoadKind: {}, AUTHENTICATOR_PICKER_TTL_MS: 30_000, accountPickerAuthorizationGeneration: async () => 'generation-1', accountPickerAuthorizationCleanupPending: () => false, accountPickerAuthorizationIsCurrent: () => true, authenticatorAccounts: async () => [], authorizedWebsiteGrant: async () => ({ grant: {} }), closeAccountPickerSurface: () => {}, emptyAccountPickerSurface: () => ({}), isAuthenticatorPickerSender: () => true, loadAuthenticatorPicker: async () => ({}), removeAuthenticatorPicker: async () => {}, storeAuthenticatorPicker: async () => {} }))
  // prettier-ignore
  mock.module('../src/background/service-worker/pairing-identity', () => ({ availableWebsiteGrants: async () => [], isAuthorizedWebsiteSender: ({ origin }: { origin: string }) => origin === authorizedOrigin, passwordPairingGrants: async () => [], randomNonce: () => 'nonce-1', sendSessionMessage }))
  // prettier-ignore
  mock.module('../src/background/service-worker/session-lifecycle', () => ({ ensureExtensionSessionDocument: async () => {} }))
  ops =
    await import('../src/background/service-worker/authenticator-operations')
})
afterAll(() => mock.restore())

const sender = {} as chrome.runtime.MessageSender
const origin = 'https://example.test'
const uri = 'otpauth://totp/Nook:test?secret=JBSWY3DPEHPK3PXP&issuer=Nook'
const missing = 'authenticator-stage-missing'
// prettier-ignore
const dismiss = (stageId: string, requestOrigin = origin) =>
  ops.websiteAuthenticatorEnrollDismiss({ message: { payload: { origin: requestOrigin, stageId } }, sender })
// prettier-ignore
const stage = (stageId: string) =>
  ops.websiteAuthenticatorEnrollStage({ message: { payload: { origin, stageId, vaultStoreId: 'vault-1', otpauthUri: uri } }, sender })
// prettier-ignore
const pending = () =>
  ops.websiteAuthenticatorEnrollPending({ message: { payload: { origin } }, sender })
const expectOk = (request: Promise<unknown>) =>
  expect(request).resolves.toEqual(expect.objectContaining({ ok: true }))
const expectReason = (request: Promise<unknown>, reason: string) =>
  expect(request).resolves.toEqual({ ok: false, reason })
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
  const delivery = Promise.withResolvers<Code>()
  stagedCodeDelivery = () => delivery.promise
  // prettier-ignore
  const request = ops.websiteAuthenticatorEnrollCode({ message: { payload: { origin, stageId } }, sender })
  await Promise.resolve()
  await invalidate()
  // prettier-ignore
  const response: Code = { ok: true, code: '654321', expiresAt: Date.now() + 30_000 }
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
  // Cancellation while authorization is in flight cannot retain the stage.
  revokeOutcome = EnrollmentRevokeOutcome.Missing
  authorizedStageIds.length = 0
  const [duringStarted, releaseDuring] = deferAuthorization(true)
  const duringStaging = stage('during')
  await duringStarted
  await expectOk(dismiss('during'))
  releaseDuring()
  await expectReason(duringStaging, missing)
  // A synchronous origin lease rejects a second request and protects foreign origin.
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
test('failed revoke and tombstone capacity retain authoritative state', async () => {
  authorizeEnrollment = async () => true
  authorizationStarted = () => {}
  revokeOutcome = EnrollmentRevokeOutcome.Committing
  expect(await stage('retry')).toEqual({ ok: true, stageId: 'retry' })
  await expectOk(dismiss('retry'))
  // prettier-ignore
  await ops.websiteAuthenticatorEnrollCode({ message: { payload: { origin, stageId: 'retry' } }, sender })
  expect(stagedCodeUris.at(-1)).toContain('secret=JBSWY3DPEHPK3PXP')
  revokeOutcome = EnrollmentRevokeOutcome.Revoked
  await expectOk(dismiss('retry'))
  // Full tombstones preserve the pending continuation and origin isolation.
  revokeOutcome = EnrollmentRevokeOutcome.Missing
  for (let index = 0; index < 128; index += 1)
    await expectOk(dismiss(`capacity-${index}`))
  const [started, release] = deferAuthorization(true)
  const staging = stage('capacity-pending')
  await started
  await expectReason(
    dismiss('capacity-pending'),
    'authenticator-retry-required',
  )
  release()
  await expectReason(staging, missing)
  authorizedOrigin = 'https://isolated.example.test'
  await expectOk(dismiss('isolated-stage', authorizedOrigin))
  authorizedOrigin = origin
})
test('stale and expired code are scrubbed and the active timer cleans up', async () => {
  authorizeEnrollment = async () => true
  revokeOutcome = EnrollmentRevokeOutcome.Revoked
  await expectDeferredCodeRejected('code-race', () => dismiss('code-race'))
  // Crossing the actual staged TTL is independently rejected.
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
