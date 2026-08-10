import { describe, expect, test } from 'bun:test'
import {
  AuthenticationOutcomeVerdict,
  AuthenticationWorkflowSnapshotResponseKind,
  AuthenticatorBackupAttachResponseKind,
  AuthenticatorCodeResponseKind,
  AuthenticatorEnrollmentConfirmResponseKind,
  AuthenticatorEnrollmentStageResponseKind,
  AuthenticatorOptionsResponseKind,
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
  sendAuthenticatorPreviewRuntimeMessage,
  sendAuthenticationWorkflowSnapshotRuntimeMessage,
  sendAuthenticationOutcomeRuntimeMessage,
  sendDecodedRuntimeMessage,
  sendLoginOptionsRuntimeMessage,
  sendLoginPickerOpenRuntimeMessage,
  sendGeneratePasswordRuntimeMessage,
} from '../src/content/autofill/runtime-message-adapter'

type TestAcknowledgement = { accepted: true }

function isTestAcknowledgement(
  response: object,
): response is TestAcknowledgement {
  return 'accepted' in response && response.accepted === true
}

enum RuntimeMockKind {
  Response = 'response',
  LastError = 'last-error',
}

type RuntimeMock =
  | { kind: RuntimeMockKind.Response; response: object }
  | { kind: RuntimeMockKind.LastError }

function installRuntimeMock(mock: RuntimeMock): void {
  const runtime = {
    sendMessage: (...parameters: [object, (response: object) => void]) => {
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

const message = { type: 'test:runtime-adapter' }

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

    const delivery = await sendLoginOptionsRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(WebsiteLoginOptionsKind.Ready)
    }
  })

  test('rejects malformed login options in Rust', async () => {
    const response = { ok: true, status: 'ready' }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginOptionsRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes the service worker locked login variant without accounts', async () => {
    const response = { ok: true, status: 'locked' }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginOptionsRuntimeMessage(message)

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

    const delivery = await sendLoginPickerOpenRuntimeMessage(message)

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

    const delivery = await sendLoginPickerOpenRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('reports Chrome runtime failures as unavailable', async () => {
    installRuntimeMock({ kind: RuntimeMockKind.LastError })

    const delivery = await sendLoginOptionsRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes a valid workflow snapshot through Rust', async () => {
    const response = {
      ok: true,
      snapshot: {
        kind: 0,
        stage: 0,
        action: 0,
        currentStep: 1,
        totalSteps: 3,
        requiresHumanApproval: true,
        observationIndex: 0,
      },
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery =
      await sendAuthenticationWorkflowSnapshotRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe(
        AuthenticationWorkflowSnapshotResponseKind.Matched,
      )
    }
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

    const delivery = await sendAuthenticatorPreviewRuntimeMessage(message)

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

    const delivery = await sendAuthenticatorPreviewRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes a completed backup attachment through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true },
    })

    const delivery = await sendAuthenticatorBackupAttachRuntimeMessage(message)

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

    const delivery = await sendAuthenticatorBackupAttachRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes only six-to-eight digit authenticator codes through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true, code: '123456' },
    })
    const ready = await sendAuthenticatorCodeRuntimeMessage(message)
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
      const delivery = await sendAuthenticatorCodeRuntimeMessage(message)
      expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
    }
  })

  test('decodes concrete authenticator enrollment identities through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true, stageId: 'stage-1' },
    })
    const staged = await sendAuthenticatorEnrollmentStageRuntimeMessage(message)
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
    const completed =
      await sendAuthenticatorEnrollmentConfirmRuntimeMessage(message)
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
          ? await sendAuthenticatorEnrollmentStageRuntimeMessage(message)
          : await sendAuthenticatorEnrollmentConfirmRuntimeMessage(message)
      expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
    }
  })

  test('decodes only non-empty generated passwords through Rust', async () => {
    installRuntimeMock({
      kind: RuntimeMockKind.Response,
      response: { ok: true, password: 'correct horse battery staple' },
    })
    const generated = await sendGeneratePasswordRuntimeMessage(message)
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
    const blank = await sendGeneratePasswordRuntimeMessage(message)
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

    const delivery = await sendAuthenticatorOptionsRuntimeMessage(message)

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

    const delivery = await sendAuthenticatorOptionsRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('rejects an out-of-range workflow snapshot through Rust', async () => {
    const response = {
      ok: true,
      snapshot: {
        kind: 0,
        stage: 0,
        action: 0,
        currentStep: -1,
        totalSteps: 300,
        requiresHumanApproval: true,
        observationIndex: -1,
      },
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery =
      await sendAuthenticationWorkflowSnapshotRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('delivers only responses accepted by a concrete decoder', async () => {
    const response = { accepted: true }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })
    const sendArgs: Parameters<
      typeof sendDecodedRuntimeMessage<TestAcknowledgement>
    >[0] = {
      message,
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
      message,
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

    const delivery = await sendAuthenticationOutcomeRuntimeMessage(message)

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

    const delivery = await sendAuthenticationOutcomeRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
  })
})
