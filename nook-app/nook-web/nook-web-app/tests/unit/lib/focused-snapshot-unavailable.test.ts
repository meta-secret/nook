import { afterEach, expect, test, vi } from 'vitest'
declare global {
  const __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__: boolean
}
import { Effect } from 'effect'
vi.hoisted(() => {
  const chromeFixture = {
    runtime: { id: 'nook-extension', onMessage: { addListener: () => {} } },
  }
  vi.stubGlobal('chrome', chromeFixture)
  vi.stubGlobal('__NOOK_EXTENSION_DIAGNOSTICS_ENABLED__', false)
})
import { AuthenticationScanRenderLifecycle } from '../../../../nook-web-extension/src/content/autofill'
import {
  scanState,
  widgetState,
} from '../../../../nook-web-extension/src/content/autofill/state'
import { focusedCredentialInteraction } from '../../../../nook-web-extension/src/content/autofill/focused-credential-interaction'
import {
  authenticationRuntimeTransport,
  RuntimeMessageDeliveryKind,
} from '../../../../nook-web-extension/src/content/autofill/runtime-message-adapter'
import {
  passwordFieldDiscovery,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  loginSaveInteraction,
  PendingSaveOfferLoadKind,
} from '../../../../nook-web-extension/src/content/autofill/login-save'
import { recoveryCopyObservation } from '../../../../nook-web-extension/src/lib/backup-code-candidates'
import { pageQrCapture } from '../../../../nook-web-extension/src/lib/page-qr-capture'
import { authenticatorEnrollmentInteraction } from '../../../../nook-web-extension/src/content/enrollment-flow'

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/companion-wasm-gate',
  () => ({
    queueSubmitCaptureUntilCompanionWasmReady: () => ({
      capture: () => {},
      discard: () => {},
      enable: () => {},
    }),
    runAfterCompanionWasmReady: async () => {},
  }),
)
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/companion-wasm-readiness',
  () => ({
    companionWasmReadiness: { waitForExtensionClassification: async () => {} },
  }),
)

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
test('an unavailable whole-page snapshot never enters focused render', async () => {
  const browserFixture = { runtime: { id: '' } }
  vi.stubGlobal('chrome', browserFixture)
  widgetState.dismissed = false
  document.body.innerHTML =
    '<form id="signin"><input autocomplete="username"><input type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>'
  vi.spyOn(
    authenticatorEnrollmentInteraction,
    'enrollmentScanBlocked',
  ).mockReturnValue(false)
  vi.spyOn(
    passwordFieldDiscovery,
    'prepareCompanionClassification',
  ).mockResolvedValue()
  vi.spyOn(
    passwordFormInteraction,
    'prepareCompanionWorkflowPolicies',
  ).mockResolvedValue()
  const absent: Awaited<
    ReturnType<typeof loginSaveInteraction.loadPendingSaveOffer>
  > = { kind: PendingSaveOfferLoadKind.Absent }
  vi.spyOn(loginSaveInteraction, 'loadPendingSaveOffer').mockImplementation(
    () => Effect.runPromise(Effect.succeed(absent)),
  )
  vi.spyOn(
    recoveryCopyObservation,
    'prepareAuthenticationRecoveryEvidence',
  ).mockResolvedValue()
  const snapshot: Awaited<
    ReturnType<
      typeof pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation
    >
  > = { metadataKey: 'fixture', observation: 'absent' }
  vi.spyOn(
    pageQrCapture,
    'prepareAuthenticationAuthenticatorSetupObservation',
  ).mockImplementation(() => Effect.runPromise(Effect.succeed(snapshot)))
  vi.spyOn(
    pageQrCapture,
    'authenticationAuthenticatorSetupSnapshotIsCurrent',
  ).mockReturnValue(true)
  const unavailable: Awaited<
    ReturnType<
      typeof authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage
    >
  > = { kind: RuntimeMessageDeliveryKind.Unavailable }
  const transport = vi
    .spyOn(
      authenticationRuntimeTransport,
      'sendAuthenticationWorkflowSnapshotRuntimeMessage',
    )
    .mockImplementation(() => Effect.runPromise(Effect.succeed(unavailable)))
  const focused = vi.spyOn(focusedCredentialInteraction, 'tryRender')
  const request: ConstructorParameters<
    typeof AuthenticationScanRenderLifecycle
  >[0] = { scanState }
  await new AuthenticationScanRenderLifecycle(request).scanAndRender()
  expect(transport).toHaveBeenCalledOnce()
  expect(focused).not.toHaveBeenCalled()
})
