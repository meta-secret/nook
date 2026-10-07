import { describe, expect, test } from 'bun:test'
import { ok, err } from 'neverthrow'
import {
  ExtensionSessionMessageDispatcher,
  ExtensionSessionMessageType,
  CompanionWasmSessionMessageType,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  decodeProviders,
  type CompanionWasmSessionMessage,
} from './session-message-dispatch-test-support'
import { handleCompanionWasmMessage } from '../src/offscreen/session-companion-wasm-operations'
import type { SessionMessageDispatchContext } from '../src/offscreen/session-message-dispatch'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'
import type {
  CompanionWasmSessionResponse,
  CompanionWasmFocusedRecognitionResponse,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { FocusedCredentialOpportunity } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'
import type { ParsedExtensionSessionTransportRequest } from '../src/offscreen/session-request-adapter'

type FocusedRuntimeGlobalFixture = {
  readonly chrome: {
    readonly runtime: Pick<typeof chrome.runtime, 'id' | 'getURL'>
  }
}

type FocusedRouteResponse =
  CompanionWasmSessionResponse | { ok: true; value: string }
class FocusedSessionRouteFixture {
  async sendSessionMessage(
    message: import('../src/offscreen/session-request-adapter').ExtensionSessionTransportRequest,
  ) {
    const { parseExtensionSessionRequest, ExtensionSessionRequestParseKind } =
      await import('../src/offscreen/session-request-adapter')
    const {
      ExtensionSessionTransportFailure,
      ExtensionSessionTransportFailureKind,
    } = await import('../src/background/service-worker/session-document')
    const { BrowserRuntimeMessage, BrowserRuntimeMessageAdmissionKind } =
      await import('../src/lib/browser-runtime-message')
    const admission = BrowserRuntimeMessage.from(message)
    switch (admission.kind) {
      case BrowserRuntimeMessageAdmissionKind.Rejected:
        return err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ),
        )
      case BrowserRuntimeMessageAdmissionKind.Accepted:
        break
    }
    const parsed = await parseExtensionSessionRequest(admission.message)
    switch (parsed.kind) {
      case ExtensionSessionRequestParseKind.Invalid:
        return err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ),
        )
      case ExtensionSessionRequestParseKind.Parsed:
        break
    }
    const result = await this.dispatcher.enqueue(parsed.request)
    return result.mapErr(
      () =>
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.DeliveryFailed,
        ),
    )
  }

  readonly handled: ParsedExtensionSessionTransportRequest[] = []
  readonly context: SessionMessageDispatchContext<FocusedRouteResponse> = {
    decodeProviders,
    handleCompanionIdentityDiscovery: async () =>
      err(
        new SessionOperationFailure(SessionOperationFailureKind.InvalidRequest),
      ),
    handleCompanionIdentityHandoff: async () =>
      err(
        new SessionOperationFailure(SessionOperationFailureKind.InvalidRequest),
      ),
    handleCompanionWasmMessage,
    handleMessage: async (message) => {
      this.handled.push(message)
      return ok({ ok: true, value: 'selected-only' })
    },
  }
  readonly dispatcher = new ExtensionSessionMessageDispatcher(this.context)
  readonly classification: Extract<
    CompanionWasmSessionMessage,
    { type: CompanionWasmSessionMessageType.ClassifyFocusedCredentialField }
  > = {
    type: CompanionWasmSessionMessageType.ClassifyFocusedCredentialField,
    payload: {
      observation: {
        inputType: 'email',
        disabled: false,
        readOnly: false,
        autocompleteTokens: ['username'],
        identityText: 'email',
        loginContext: false,
      },
    },
  }
  async recognize(): Promise<CompanionWasmFocusedRecognitionResponse> {
    const result = await this.dispatcher.enqueueCompanionWasmMessage(
      this.classification,
    )
    switch (result.isOk()) {
      case false:
        throw new Error('real focused recognition route failed')
      case true:
        break
    }
    const response = result._unsafeUnwrap()
    switch (true) {
      case typeof response === 'object' && 'focusedOpportunity' in response:
        return response
      case true:
        throw new Error('recognition response absent')
    }
    throw new Error('recognition response absent')
  }
}

describe('focused generated offscreen dispatcher routes', () => {
  test('classifies and revalidates with owned generated recognition', async () => {
    const fixture = new FocusedSessionRouteFixture()
    const recognized = await fixture.recognize()
    expect(recognized.focusedOpportunity).toBe(
      FocusedCredentialOpportunity.Username,
    )
    const request: CompanionWasmSessionMessage = {
      type: CompanionWasmSessionMessageType.RevalidateFocusedCredentialField,
      payload: {
        ...fixture.classification.payload,
        opportunity: recognized.focusedOpportunity,
      },
    }
    const revalidated =
      await fixture.dispatcher.enqueueCompanionWasmMessage(request)
    expect(revalidated._unsafeUnwrap()).toEqual(recognized)
  })
  test('admits the canonical generated focused reveal through the real prefixed listener', async () => {
    const fixture = new FocusedSessionRouteFixture()
    const recognized = await fixture.recognize()
    switch (recognized.focusedOpportunity) {
      case FocusedCredentialOpportunity.Unavailable:
        throw new Error('credential selection absent')
      case FocusedCredentialOpportunity.Username:
      case FocusedCredentialOpportunity.CurrentPassword:
        break
    }
    const shim: FocusedRuntimeGlobalFixture = {
      chrome: {
        runtime: {
          id: 'nook-extension',
          getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
        },
      },
    }
    Object.assign(globalThis, shim)
    const message: ParsedExtensionSessionTransportRequest = {
      type: ExtensionSessionMessageType.RevealFocusedLogin,
      payload: {
        vaultStoreId: 'store_abcdefghijk',
        deviceId: 'device',
        devicePublicKey: 'public',
        deviceSigningPublicKey: 'signing',
        origin: 'https://example.com',
        secretId: 'selected',
        credential: recognized.focusedSelection.credential,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const sender: chrome.runtime.MessageSender = { id: 'nook-extension' }
    const response = Promise.withResolvers<unknown>()
    const admitted = fixture.dispatcher.listener()(
      message,
      sender,
      response.resolve,
    )
    expect(Boolean(admitted)).toBe(true)
    const expected: FocusedRouteResponse = { ok: true, value: 'selected-only' }
    expect(await response.promise).toEqual(expected)
    expect(fixture.handled).toHaveLength(1)
    expect(fixture.handled[0]?.type).toBe(
      ExtensionSessionMessageType.RevealFocusedLogin,
    )
  })
})

describe('focused service-worker release route', () => {
  test('projects generated selection and receives one value through actual Rust ingress', async () => {
    const { FocusedWebsiteLoginFillOperation } =
      await import('../src/background/service-worker/focused-login-operations')
    const fixture = new FocusedSessionRouteFixture()
    const recognized = await fixture.recognize()
    switch (recognized.focusedOpportunity) {
      case FocusedCredentialOpportunity.Unavailable:
        throw new Error('credential selection absent')
      case FocusedCredentialOpportunity.Username:
      case FocusedCredentialOpportunity.CurrentPassword:
        break
    }
    const grant: import('../src/background/pairing-grants').StoredExtensionPairingGrant =
      {
        vaultType: 'simple',
        deviceId: 'device',
        devicePublicKey: 'public',
        deviceSigningPublicKey: 'signing',
        deviceLabel: 'fixture',
        vaultStoreId: 'store_abcdefghijk',
        vaultName: 'fixture',
        approvedAt: 1,
        scopes: [],
        syncProviderCount: 0,
        eventCount: 0,
        eventLogHeads: [],
        lastLocalSyncAt: '',
      }
    const dependencies: import('../src/background/service-worker/focused-login-operations').FocusedWebsiteLoginFillDependencies =
      {
        generationIsCurrent: () => true,
        authorizedWebsiteGrant: async () => ({ grant }),
        sendSessionMessage: fixture.sendSessionMessage.bind(fixture),
      }
    const { WebsiteFocusedLoginRevealMessageType } =
      await import('../src/lib/focused-login-fill-messages')
    const configuration: ConstructorParameters<
      typeof FocusedWebsiteLoginFillOperation
    >[0] = {
      dependencies,
      request: {
        sender: { id: 'nook-extension', url: 'https://example.com' },
        message: {
          type: WebsiteFocusedLoginRevealMessageType.Reveal,
          payload: {
            origin: 'https://example.com',
            vaultStoreId: grant.vaultStoreId,
            secretId: 'selected',
            authorizationGeneration: 'generation',
            credential: recognized.focusedSelection.credential,
          },
        },
      },
    }
    const response = await new FocusedWebsiteLoginFillOperation(
      configuration,
    ).run()
    const expected: import('../src/lib/focused-login-fill-messages').WebsiteFocusedLoginFillResponse =
      { ok: true, value: 'selected-only' }
    expect(response).toEqual(expected)
    expect(Object.keys(response)).toEqual(['ok', 'value'])
    expect(fixture.handled).toHaveLength(1)
  })
})
