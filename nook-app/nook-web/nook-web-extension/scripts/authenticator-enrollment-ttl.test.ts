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
        return {
          ok: true,
          outcome: (await authorizeEnrollment())
            ? EnrollmentAuthorizeOutcome.Authorized
            : EnrollmentAuthorizeOutcome.Invalid,
        }
      }
      if (type.endsWith('revoke')) {
        revokedStageIds.push(payload.enrollmentAuthorizationId as string)
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
test('staged enrollment cancel during authorization prevents staging', async () => {
  revokeOutcome = EnrollmentRevokeOutcome.Missing
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
test('same-origin staging lease rejects a second request before authorization resolves', async () => {
  authorizedStageIds.length = 0
  const [started, release] = deferAuthorization(true)
  const first = stage('origin-lease-first')
  await started
  await expectReason(stage('origin-lease-second'), missing)
  expect(authorizedStageIds).toEqual(['origin-lease-first'])
  release()
  await expect(first).resolves.toEqual({
    ok: true,
    stageId: 'origin-lease-first',
  })
  revokeOutcome = EnrollmentRevokeOutcome.Revoked
  await expectOk(dismiss('origin-lease-first'))
})
test('staged enrollment full tombstones preserve origin isolation', async () => {
  revokeOutcome = EnrollmentRevokeOutcome.Missing
  const capacityOrigin = 'https://capacity.example.test'
  authorizedOrigin = capacityOrigin
  for (let index = 0; index < 128; index += 1)
    await expectOk(dismiss(`capacity-${index}`, capacityOrigin))
  await expectReason(
    dismiss('capacity-overflow', capacityOrigin),
    'authenticator-retry-required',
  )
  authorizedOrigin = 'https://isolated.example.test'
  await expectOk(dismiss('isolated-stage', authorizedOrigin))
  authorizedOrigin = origin
})
test('code returned after exact stage ownership is revoked is scrubbed', async () => {
  authorizeEnrollment = async () => true
  revokeOutcome = EnrollmentRevokeOutcome.Revoked
  expect(await stage('code-race')).toEqual({ ok: true, stageId: 'code-race' })
  const delivery = Promise.withResolvers<{
    ok: true
    code: string
    expiresAt: number
  }>()
  stagedCodeDelivery = () => delivery.promise
  const codeRequest = ops.websiteAuthenticatorEnrollCode(
    dismissArgs('code-race'),
  )
  await Promise.resolve()
  await expectOk(dismiss('code-race'))
  const response = {
    ok: true as const,
    code: '654321',
    expiresAt: Date.now() + 30_000,
  }
  delivery.resolve(response)
  await expectReason(codeRequest, missing)
  expect(response.code).toBe('')
  stagedCodeDelivery = async () => ({
    ok: true,
    code: '123456',
    expiresAt: Date.now() + 30_000,
  })
})
