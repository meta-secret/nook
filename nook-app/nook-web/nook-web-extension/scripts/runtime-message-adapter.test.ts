import { describe, expect, test } from 'bun:test'
import {
  AuthenticationOutcomeVerdict,
  AuthenticationOutcomeResponseKind,
  AuthenticatorBackupAttachResponseKind,
  AuthenticatorCodeResponseKind,
  AuthenticatorEnrollmentConfirmResponseKind,
  AuthenticatorEnrollmentStageResponseKind,
  AuthenticatorOptionsResponseKind,
  AuthenticatorPickerOpenResponseKind,
  AuthenticatorPreviewResponseKind,
  GeneratedPasswordResponseKind,
  LoginPickerOpenResponseKind,
  WebsiteLoginOptionsKind,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  RuntimeMessageDeliveryKind,
  sendAuthenticatorBackupAttachRuntimeMessage,
  sendAuthenticatorCodeRuntimeMessage,
  sendAuthenticatorEnrollmentConfirmRuntimeMessage,
  sendAuthenticatorEnrollmentStageRuntimeMessage,
  sendAuthenticatorOptionsRuntimeMessage,
  sendAuthenticatorPickerOpenRuntimeMessage,
  sendAuthenticatorPreviewRuntimeMessage,
  sendAuthenticationWorkflowSnapshotRuntimeMessage,
  sendAuthenticationOutcomeRuntimeMessage,
  sendDecodedRuntimeMessage,
  sendLoginOptionsRuntimeMessage,
  sendLoginPickerOpenRuntimeMessage,
  sendLoginSaveOfferRuntimeMessage,
  sendGeneratePasswordRuntimeMessage,
} from '../src/content/autofill/runtime-message-adapter'
import { GeneratePasswordRequestType } from '../../nook-web-shared/src/extension/runtime-messages'
import {
  AuthenticationWorkflowSnapshotMessageType,
  type WebsiteLoginMatchAvailability,
} from '../src/lib/auth-workflow-messages'
import { WebsiteAuthenticatorPickerOpenMessageType } from '../src/lib/authenticator-picker-messages'
import {
  WebsiteAuthenticatorBackupAttachMessageMode,
  WebsiteAuthenticatorBackupAttachMessageType,
  WebsiteAuthenticatorEnrollCodeMessageType,
  WebsiteAuthenticatorEnrollConfirmMessageType,
  WebsiteAuthenticatorEnrollPreviewMessageType,
  WebsiteAuthenticatorEnrollStageMessageType,
} from '../src/lib/enrollment-messages'
import {
  WebsiteAuthenticatorOptionsMessageType,
  WebsiteLoginOptionsMessageType,
} from '../src/lib/login-fill-messages'
import { WebsiteLoginPickerOpenMessageType } from '../src/lib/login-picker-messages'
import { WebsiteLoginSaveOfferMessageType } from '../src/lib/login-save-messages'
import { AuthenticationOutcomeClassifyMessageType } from '../src/lib/outcome-evidence-messages'

type TestAcknowledgement = { accepted: true }

function isTestAcknowledgement(
  response: unknown,
): response is TestAcknowledgement {
  return (
    !!response &&
    typeof response === 'object' &&
    'accepted' in response &&
    response.accepted === true
  )
}

enum RuntimeMockKind {
  Response = 'response',
  LastError = 'last-error',
}

type RuntimeMock =
  | { kind: RuntimeMockKind.Response; response: unknown }
  | { kind: RuntimeMockKind.LastError }

function installRuntimeMock(mock: RuntimeMock): void {
  const runtime = {
    sendMessage: (...parameters: [unknown, (response: unknown) => void]) => {
      const callback = parameters[1]
      const response =
        mock.kind === RuntimeMockKind.Response ? mock.response : {}
      callback(response)
    },
  }
  if (mock.kind === RuntimeMockKind.LastError) {
    const lastErrorDescriptor: PropertyDescriptor = {
      value: { message: 'extension context unavailable' },
    }
    Object.defineProperty(runtime, 'lastError', lastErrorDescriptor)
  }
  globalThis.chrome = { runtime } as typeof chrome
}

const loginOptionsMessage: Parameters<
  typeof sendLoginOptionsRuntimeMessage
>[0] = {
  type: WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions,
  payload: { origin: 'https://example.test' },
}
const loginSaveOfferMessage: Parameters<
  typeof sendLoginSaveOfferRuntimeMessage
>[0] = {
  type: WebsiteLoginSaveOfferMessageType.NookWebsiteLoginSaveOffer,
  payload: {
    origin: 'https://example.test',
    username: 'person@example.test',
    password: 'secret',
  },
}
const loginPickerOpenMessage: Parameters<
  typeof sendLoginPickerOpenRuntimeMessage
>[0] = {
  type: WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen,
  payload: { origin: 'https://example.test' },
}
const authenticatorPickerOpenMessage: Parameters<
  typeof sendAuthenticatorPickerOpenRuntimeMessage
>[0] = {
  type: WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen,
  payload: { origin: 'https://example.test' },
}
const workflowSnapshotMessage: Parameters<
  typeof sendAuthenticationWorkflowSnapshotRuntimeMessage
>[0] = {
  type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
  payload: { origin: 'https://example.test', observations: [] },
}
const authenticatorPreviewMessage: Parameters<
  typeof sendAuthenticatorPreviewRuntimeMessage
>[0] = {
  type: WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview,
  payload: {
    origin: 'https://example.test',
    otpauthUri: 'otpauth://totp/Nook:test',
  },
}
const authenticatorBackupAttachMessage: Parameters<
  typeof sendAuthenticatorBackupAttachRuntimeMessage
>[0] = {
  type: WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach,
  payload: {
    origin: 'https://example.test',
    vaultStoreId: 'vault',
    secretId: 'secret',
    codes: ['backup'],
    mode: WebsiteAuthenticatorBackupAttachMessageMode.Merge,
  },
}
const authenticatorCodeMessage: Parameters<
  typeof sendAuthenticatorCodeRuntimeMessage
>[0] = {
  type: WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode,
  payload: { origin: 'https://example.test', stageId: 'stage' },
}
const authenticatorStageMessage: Parameters<
  typeof sendAuthenticatorEnrollmentStageRuntimeMessage
>[0] = {
  type: WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage,
  payload: {
    origin: 'https://example.test',
    vaultStoreId: 'vault',
    otpauthUri: 'otpauth://totp/Nook:test',
  },
}
const authenticatorConfirmMessage: Parameters<
  typeof sendAuthenticatorEnrollmentConfirmRuntimeMessage
>[0] = {
  type: WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm,
  payload: {
    origin: 'https://example.test',
    vaultStoreId: 'vault',
    stageId: 'stage',
  },
}
const generatedPasswordMessage: Parameters<
  typeof sendGeneratePasswordRuntimeMessage
>[0] = {
  type: GeneratePasswordRequestType.NookWebsiteGeneratePassword,
  payload: { origin: 'https://example.test' },
}
const authenticatorOptionsMessage: Parameters<
  typeof sendAuthenticatorOptionsRuntimeMessage
>[0] = {
  type: WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions,
  payload: { origin: 'https://example.test' },
}
const authenticationOutcomeMessage: Parameters<
  typeof sendAuthenticationOutcomeRuntimeMessage
>[0] = {
  type: AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
  payload: {
    observation: {
      navigatedAwayFromAuthPath: false,
      authFieldsPresent: true,
      successMarkerPresent: false,
      errorMarkerPresent: false,
      sameDocumentMutation: false,
      inIframe: false,
      elapsedMs: 1,
    },
    timeoutMs: 1,
  },
}

describe('runtime message adapters', () => {
  test('initializes companion WASM before decoding a valid login options wire', async () => {
    const response = {
      ok: true,
      status: 'ready',
      accounts: [
        {
          vaultStoreId: 'vault-1',
          vaultName: 'Personal',
          secretId: 'secret-1',
          username: 'person@example.test',
          websiteUrl: 'https://example.test/login',
          websiteHost: 'example.test',
        },
      ],
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginOptionsRuntimeMessage(loginOptionsMessage)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(WebsiteLoginOptionsKind.Ready)
    }
  })

  test('rejects malformed login options in Rust', async () => {
    const response = { ok: true, status: 'ready' }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginOptionsRuntimeMessage(loginOptionsMessage)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('rejects contradictory login-save offers in Rust', async () => {
    const response = {
      kind: 'offer-available',
      offer: {
        offerId: 'offer-1',
        decision: 0,
        vaultStoreId: 'vault-1',
        vaultName: 'Personal',
      },
      reason: 'login-save-plan-failed',
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginSaveOfferRuntimeMessage(
      loginSaveOfferMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes the service worker locked login variant without accounts', async () => {
    const response = { ok: true, status: 'locked' }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginOptionsRuntimeMessage(loginOptionsMessage)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(WebsiteLoginOptionsKind.Locked)
    }
  })

  test('decodes a valid login picker response in Rust', async () => {
    const response = {
      ok: true,
      status: 'ready',
      requestId: 'request-1',
      expiresAt: 12_345,
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginPickerOpenRuntimeMessage(
      loginPickerOpenMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(LoginPickerOpenResponseKind.Ready)
      if (delivery.response.kind === LoginPickerOpenResponseKind.Ready) {
        expect(delivery.response.requestId).toBe('request-1')
        expect(delivery.response.expiresAt).toBe(12_345)
      }
    }
  })

  test('rejects malformed login picker responses in Rust', async () => {
    const response = {
      ok: true,
      status: 'locked',
      requestId: 'unexpected',
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginPickerOpenRuntimeMessage(
      loginPickerOpenMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes a valid authenticator picker response in Rust', async () => {
    const response = {
      ok: true,
      status: 'ready',
      requestId: 'authenticator-request',
      expiresAt: 42,
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticatorPickerOpenRuntimeMessage(
      authenticatorPickerOpenMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(
        AuthenticatorPickerOpenResponseKind.Ready,
      )
    }
  })

  test('rejects contradictory authenticator picker fields in Rust', async () => {
    const response = {
      ok: true,
      status: 'ready',
      requestId: 'authenticator-request',
      expiresAt: 42,
      reason: 'picker-failed',
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticatorPickerOpenRuntimeMessage(
      authenticatorPickerOpenMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('reports Chrome runtime failures as unavailable', async () => {
    installRuntimeMock({ kind: RuntimeMockKind.LastError })

    const delivery = await sendLoginOptionsRuntimeMessage(loginOptionsMessage)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes a valid workflow snapshot through Rust', async () => {
    const response = {
      workflow: {
        ok: true,
        snapshot: {
          kind: 'login',
          stage: 'credentials',
          action: 'continue-with-nook',
          currentStep: 1,
          totalSteps: 3,
          approvalRequirement: 'explicit-user-approval',
          observationIndex: 0,
        },
      },
      loginMatches: {
        kind: 'ready',
        count: 0,
      },
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticationWorkflowSnapshotRuntimeMessage(
      workflowSnapshotMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.workflow.kind).toBe('matched')
      const expectedLoginMatches: WebsiteLoginMatchAvailability = {
        kind: 'ready',
        count: 0,
      }
      expect(delivery.response.loginMatches).toEqual(expectedLoginMatches)
    }
  })

  test('rejects a workflow snapshot without Rust approval policy', async () => {
    const response = {
      workflow: {
        ok: true,
        snapshot: {
          kind: 'login',
          stage: 'credentials',
          action: 'continue-with-nook',
          currentStep: 1,
          totalSteps: 3,
          observationIndex: 0,
        },
      },
      loginMatches: { kind: 'unavailable' },
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticationWorkflowSnapshotRuntimeMessage(
      workflowSnapshotMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes a concrete authenticator preview through Rust', async () => {
    const response = {
      ok: true,
      status: 'ready',
      preview: {
        issuer: 'Nook',
        account: 'person@example.test',
        websiteUrl: 'https://example.test',
        algorithm: 'SHA256',
        digits: 6,
        period: 30,
      },
      vaultStoreId: 'vault-1',
      vaultName: 'Personal',
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticatorPreviewRuntimeMessage(
      authenticatorPreviewMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(
        AuthenticatorPreviewResponseKind.Ready,
      )
      if (delivery.response.kind === AuthenticatorPreviewResponseKind.Ready) {
        expect(delivery.response.vaultStoreId).toBe('vault-1')
        expect(delivery.response.preview.algorithm).toBe('SHA256')
      }
    }
  })

  test('rejects malformed authenticator preview metadata in Rust', async () => {
    const response = {
      ok: true,
      status: 'ready',
      preview: {
        issuer: 'Nook',
        account: 'person@example.test',
        websiteUrl: 'https://example.test',
        algorithm: 'MD5',
        digits: 6.5,
        period: -1,
      },
      vaultStoreId: 'vault-1',
      vaultName: 'Personal',
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticatorPreviewRuntimeMessage(
      authenticatorPreviewMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes a completed backup attachment through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true },
    })

    const delivery = await sendAuthenticatorBackupAttachRuntimeMessage(
      authenticatorBackupAttachMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(
        AuthenticatorBackupAttachResponseKind.Completed,
      )
    }
  })

  test('rejects a contradictory backup attachment through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true, reason: 'authenticator-locked' },
    })

    const delivery = await sendAuthenticatorBackupAttachRuntimeMessage(
      authenticatorBackupAttachMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes only six-to-eight digit authenticator codes through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true, code: '123456' },
    })
    const ready = await sendAuthenticatorCodeRuntimeMessage(
      authenticatorCodeMessage,
    )
    expect(ready.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (ready.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(ready.response.kind).toBe(AuthenticatorCodeResponseKind.Ready)
    }

    for (const response of [
      { ok: true, code: 'not-a-totp' },
      { ok: true, code: '12345' },
      { ok: true, code: '123456', reason: 'contradiction' },
    ]) {
      installRuntimeMock({ kind: RuntimeMockKind.Response, response })
      const delivery = await sendAuthenticatorCodeRuntimeMessage(
        authenticatorCodeMessage,
      )
      expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
    }
  })

  test('decodes concrete authenticator enrollment identities through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true, stageId: 'stage-1' },
    })
    const staged = await sendAuthenticatorEnrollmentStageRuntimeMessage(
      authenticatorStageMessage,
    )
    expect(staged.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (staged.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(staged.response.kind).toBe(
        AuthenticatorEnrollmentStageResponseKind.Staged,
      )
    }

    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true, secretId: 'secret-1' },
    })
    const completed = await sendAuthenticatorEnrollmentConfirmRuntimeMessage(
      authenticatorConfirmMessage,
    )
    expect(completed.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (completed.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(completed.response.kind).toBe(
        AuthenticatorEnrollmentConfirmResponseKind.Completed,
      )
    }
  })

  test('rejects blank and contradictory authenticator enrollment identities through Rust', async () => {
    for (const response of [
      { ok: true, stageId: ' ' },
      { ok: true, secretId: 'secret-1', reason: 'contradiction' },
    ]) {
      installRuntimeMock({ kind: RuntimeMockKind.Response, response })
      const delivery =
        'stageId' in response
          ? await sendAuthenticatorEnrollmentStageRuntimeMessage(
              authenticatorStageMessage,
            )
          : await sendAuthenticatorEnrollmentConfirmRuntimeMessage(
              authenticatorConfirmMessage,
            )
      expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
    }
  })

  test('decodes only non-empty generated passwords through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true, password: 'correct horse battery staple' },
    })
    const generated = await sendGeneratePasswordRuntimeMessage(
      generatedPasswordMessage,
    )
    expect(generated.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (generated.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(generated.response.kind).toBe(
        GeneratedPasswordResponseKind.Generated,
      )
    }

    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true, password: '' },
    })
    const blank = await sendGeneratePasswordRuntimeMessage(
      generatedPasswordMessage,
    )
    expect(blank.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes concrete authenticator account identities through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: {
        ok: true,
        status: 'ready',
        accounts: [
          {
            vaultStoreId: 'vault-1',
            vaultName: 'Personal',
            secretId: 'secret-1',
            issuer: 'Nook',
            account: 'person@example.test',
          },
        ],
      },
    })

    const delivery = await sendAuthenticatorOptionsRuntimeMessage(
      authenticatorOptionsMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(
        AuthenticatorOptionsResponseKind.Ready,
      )
    }
  })

  test('rejects blank authenticator account identities through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: {
        ok: true,
        status: 'ready',
        accounts: [
          {
            vaultStoreId: ' ',
            vaultName: 'Personal',
            secretId: 'secret-1',
            issuer: 'Nook',
            account: 'person@example.test',
          },
        ],
      },
    })

    const delivery = await sendAuthenticatorOptionsRuntimeMessage(
      authenticatorOptionsMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('rejects an out-of-range workflow snapshot through Rust', async () => {
    const response = {
      workflow: {
        ok: true,
        snapshot: {
          kind: 0,
          stage: 0,
          action: 0,
          currentStep: -1,
          totalSteps: 300,
          approvalRequirement: 'explicit-user-approval',
          observationIndex: -1,
        },
      },
      loginMatches: { kind: 'unavailable' },
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticationWorkflowSnapshotRuntimeMessage(
      workflowSnapshotMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('rejects malformed login-match availability before rendering', async () => {
    const response = {
      workflow: { ok: true },
      loginMatches: {
        kind: 'ready',
        count: -1,
      },
    }
    const runtimeMock: RuntimeMock = {
      kind: RuntimeMockKind.Response,
      response,
    }
    installRuntimeMock(runtimeMock)

    const delivery = await sendAuthenticationWorkflowSnapshotRuntimeMessage(
      workflowSnapshotMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('delivers only responses accepted by a concrete decoder', async () => {
    const response = { accepted: true }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })
    const sendArgs: Parameters<
      typeof sendDecodedRuntimeMessage<TestAcknowledgement>
    >[0] = {
      message: generatedPasswordMessage,
      decode: isTestAcknowledgement,
    }

    const delivery =
      await sendDecodedRuntimeMessage<TestAcknowledgement>(sendArgs)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
  })

  test('rejects a response refused by its concrete decoder', async () => {
    const response = { accepted: false }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })
    const sendArgs: Parameters<
      typeof sendDecodedRuntimeMessage<TestAcknowledgement>
    >[0] = {
      message: generatedPasswordMessage,
      decode: isTestAcknowledgement,
    }

    const delivery =
      await sendDecodedRuntimeMessage<TestAcknowledgement>(sendArgs)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('rejects an outcome decision that contradicts its Rust verdict', async () => {
    const response = {
      ok: true,
      verdict: {
        verdict: AuthenticationOutcomeVerdict.Insufficient,
        allowsCredentialCommit: true,
      },
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticationOutcomeRuntimeMessage(
      authenticationOutcomeMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('accepts a consistent outcome decision through Rust', async () => {
    const response = {
      ok: true,
      verdict: {
        verdict: AuthenticationOutcomeVerdict.Sufficient,
        allowsCredentialCommit: true,
      },
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticationOutcomeRuntimeMessage(
      authenticationOutcomeMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(
        AuthenticationOutcomeResponseKind.Completed,
      )
    }
  })

  test('rejects contradictory outer outcome fields in Rust', async () => {
    const response = {
      ok: true,
      verdict: {
        verdict: AuthenticationOutcomeVerdict.Sufficient,
        allowsCredentialCommit: true,
      },
      reason: 'outcome-classify-failed',
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticationOutcomeRuntimeMessage(
      authenticationOutcomeMessage,
    )

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })
})
