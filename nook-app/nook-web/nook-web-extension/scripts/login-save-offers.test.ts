import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
  PendingLoginSaveLookupState,
  pendingLoginSaveOfferStore,
  type PendingLoginSaveOffer,
  type PendingLoginSaveOfferScope,
} from '../src/offscreen/login-save-offers'
import { NookWebsiteLoginSaveDecision } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { LoginSaveSessionOperations, type LoginSaveSessionManager } from '../src/offscreen/session-login-save-operations'
import type { ExtensionSessionRequest } from '../src/offscreen/session-request-adapter'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'

type LoginSavePlanRequest = Extract<ExtensionSessionRequest, {type: typeof ExtensionSessionMessageType.PlanLoginSave}>
enum LoginSaveFixtureCapture {Credentials = 'credentials', OneTimeCode = 'one-time-code', UnrelatedEnter = 'unrelated-enter'}

/** Owns pending credential fixtures and their short-lived expiry resources. */
class PendingLoginSaveFixture {
  managerOpenCount = 0
  readonly scope: PendingLoginSaveOfferScope = {
    origin: 'https://login.example.test',
    tabId: 12,
    frameId: 0,
  }

  offer(scope: PendingLoginSaveOfferScope): PendingLoginSaveOffer {
    return {
      offerId: `${scope.tabId}:${scope.frameId}`,
      ...scope,
      username: 'fixture-user',
      password: 'fixture-password',
      vaultStoreId: 'vault-fixture',
      decision: NookWebsiteLoginSaveDecision.Create,
      selection: {kind: 'SubmittedLogin', username_field_index: {value: 0}, password_field_index: {value: 1}},
      baseline: {source: 'SubmittedLogin', submitted_at: Date.now(), submitted_url: scope.origin + '/login', captured_workflow: 0, initial_auth_fields: 'Present', controls: []},
      expiresAt: Date.now() + 120_000,
      expiryTimer: setTimeout(() => {}, 120_000),
    }
  }

  manager(decision: NookWebsiteLoginSaveDecision): LoginSaveSessionManager {
    return {
      open_extension_passkey_vault_js: async () => {this.managerOpenCount += 1},
      plan_website_login_save: async () => ({decision, secretId: 'existing-login', free: () => {}}),
      commit_submitted_website_login_save: async () => {throw new Error('unused fixture commit')},
      commit_website_login_save: async () => {throw new Error('unused fixture commit')},
      load_auth_providers_snapshot: async () => {throw new Error('unused fixture provider')},
      flush_event_outbox_for_provider: async () => {throw new Error('unused fixture flush')},
    }
  }

  request(mode: LoginSaveFixtureCapture): LoginSavePlanRequest {
    const metadata: LoginSavePlanRequest['payload']['capture']['fields'] = [
      {input_type: 'text', disabled: false, read_only: false, autocomplete_tokens: ['username'], identity_text: 'Username', login_context: false, password_history: 'Unobserved'},
      {input_type: 'password', disabled: false, read_only: false, autocomplete_tokens: ['current-password'], identity_text: 'Password', login_context: false, password_history: 'PreviouslyPassword'},
    ]
    const values = ['new-user', 'new-password']
    const intent: LoginSavePlanRequest['payload']['capture']['intent'] = {
      event: 'FormSubmit', trust: 'Trusted', target: {kind: 'CredentialScope'}, control_label: 'Sign in', context: {
        fields: {usernameFieldCount: 0, currentPasswordFieldCount: 0, newPasswordFieldCount: 0, genericPasswordFieldCount: 0, oneTimeCodeFieldCount: 0, actionablePasswordFieldCount: 0, readonlyPasswordFieldCount: 0},
        ceremony: {oneTimeCodeProgression: 'advance-control-required', oneTimeCodeHandlerSignal: '', authenticationContext: {authenticationUsername: 'absent', sourceOrigin: this.scope.origin, formIdentity: 'login', destinationIdentity: '/login'}, manualCheckpoint: 'absent', advanceControl: 'absent'},
        authenticator: {authenticatorSetup: 'absent', backupCodesCopy: '', passkeyControl: 'absent', passkeyAccountAvailability: 'unavailable', matchingPasskeyAccountCount: 0, detailedPasskeyControl: {kind: 'absent'}},
        credentialSubmission: {kind: 'absent'}, detailedAdvanceControl: {kind: 'absent'},
      },
    }
    switch (mode) {
      case LoginSaveFixtureCapture.Credentials: break
      case LoginSaveFixtureCapture.OneTimeCode: {
        const field: LoginSavePlanRequest['payload']['capture']['fields'][number] = {input_type: 'text', disabled: false, read_only: false, autocomplete_tokens: ['one-time-code'], identity_text: 'OTP', login_context: false, password_history: 'Unobserved'}
        metadata.splice(0, metadata.length, field)
        values.splice(0, values.length, '123456')
        break
      }
      case LoginSaveFixtureCapture.UnrelatedEnter: {
        const field: LoginSavePlanRequest['payload']['capture']['fields'][number] = {input_type: 'search', disabled: false, read_only: false, autocomplete_tokens: [], identity_text: 'Search', login_context: false, password_history: 'Unobserved'}
        metadata.unshift(field)
        values.unshift('search-query')
        intent.event = 'Enter'
        intent.target = {kind: 'CredentialField', field_index: {value: 0}}
        break
      }
    }
    return {
      type: ExtensionSessionMessageType.PlanLoginSave,
      payload: {
        vaultStoreId: 'vault-fixture', deviceId: 'device', devicePublicKey: 'public', deviceSigningPublicKey: 'signing',
        origin: this.scope.origin, sender: {tab_id: this.scope.tabId, frame_id: this.scope.frameId}, username: '', password: '',
        capturedValues: values, capture: {intent, fields: metadata, submitted_at: Date.now(), submitted_url: this.scope.origin + '/login', controls: ['Sign in'], explicit_candidate: 'Absent'},
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
  }
}

beforeAll(() => companionWasmReady)

afterEach(() => pendingLoginSaveOfferStore.clearAll())

describe('pending submitted login scope', () => {
  test('an admitted Invalid or AlreadySaved credential plan clears its prior candidate', async () => {
    Reflect.set(globalThis, '__NOOK_SIMPLE_VAULT_URL__', 'https://simple.example.test/')
    for (const decision of [NookWebsiteLoginSaveDecision.Invalid, NookWebsiteLoginSaveDecision.AlreadySaved]) {
      const fixture = new PendingLoginSaveFixture()
      const prior = fixture.offer(fixture.scope)
      pendingLoginSaveOfferStore.store(prior)
      const manager = fixture.manager(decision)
      const access: ConstructorParameters<typeof LoginSaveSessionOperations>[0] = async () => manager
      const operation = new LoginSaveSessionOperations(access)
      const response = await operation.handle(fixture.request(LoginSaveFixtureCapture.Credentials))
      expect(response.isOk()).toBe(true)
      expect(fixture.managerOpenCount).toBe(1)
      expect(pendingLoginSaveOfferStore.findByScope(fixture.scope).state).toBe(PendingLoginSaveLookupState.Unavailable)
      expect(prior.username).toBe('')
      expect(prior.password).toBe('')
    }
  })
  test('Rust Ignored search and OTP-only captures preserve the prior credential candidate', async () => {
    Reflect.set(globalThis, '__NOOK_SIMPLE_VAULT_URL__', 'https://simple.example.test/')
    for (const mode of [LoginSaveFixtureCapture.UnrelatedEnter, LoginSaveFixtureCapture.OneTimeCode]) {
      const fixture = new PendingLoginSaveFixture()
      const prior = fixture.offer(fixture.scope)
      pendingLoginSaveOfferStore.store(prior)
      const manager = fixture.manager(NookWebsiteLoginSaveDecision.Invalid)
      const access: ConstructorParameters<typeof LoginSaveSessionOperations>[0] = async () => manager
      const response = await new LoginSaveSessionOperations(access).handle(fixture.request(mode))
      expect(response.isErr()).toBe(true)
      expect(fixture.managerOpenCount).toBe(0)
      expect(pendingLoginSaveOfferStore.findByScope(fixture.scope).state).toBe(PendingLoginSaveLookupState.Available)
      expect(prior.password).toBe('fixture-password')
      pendingLoginSaveOfferStore.clearAll()
    }
  })
  test('allows the same origin tab and frame without retaining document identity', () => {
    const fixture = new PendingLoginSaveFixture()
    const offer = fixture.offer(fixture.scope)
    pendingLoginSaveOfferStore.store(offer)

    const expectedOffer: ReturnType<typeof pendingLoginSaveOfferStore.findByScope> = {state: PendingLoginSaveLookupState.Available, offer}
    expect(pendingLoginSaveOfferStore.findByScope(fixture.scope)).toEqual(expectedOffer)
  })

  test('does not expose or clear another tab or frame on the same origin', () => {
    const fixture = new PendingLoginSaveFixture()
    const offer = fixture.offer(fixture.scope)
    pendingLoginSaveOfferStore.store(offer)
    const foreignTab: PendingLoginSaveOfferScope = {
      ...fixture.scope,
      tabId: 13,
    }
    const foreignFrame: PendingLoginSaveOfferScope = {
      ...fixture.scope,
      frameId: 2,
    }
    for (const scope of [foreignTab, foreignFrame]) {
      expect(pendingLoginSaveOfferStore.findByScope(scope).state).toBe(
        PendingLoginSaveLookupState.Unavailable,
      )
      const request: Parameters<typeof pendingLoginSaveOfferStore.findById>[0] = {offerId: offer.offerId, scope}
      expect(pendingLoginSaveOfferStore.findById(request).state).toBe(PendingLoginSaveLookupState.Unavailable)
      pendingLoginSaveOfferStore.clearById(request)
      pendingLoginSaveOfferStore.clearForScope(scope)
    }
    expect(pendingLoginSaveOfferStore.findByScope(fixture.scope).state).toBe(
      PendingLoginSaveLookupState.Available,
    )
  })

  test('replacement clears only credentials from the same origin tab and frame', () => {
    const fixture = new PendingLoginSaveFixture()
    const otherScope: PendingLoginSaveOfferScope = {
      ...fixture.scope,
      tabId: 13,
    }
    const replaced = fixture.offer(fixture.scope)
    const other = fixture.offer(otherScope)
    pendingLoginSaveOfferStore.store(replaced)
    pendingLoginSaveOfferStore.store(other)

    pendingLoginSaveOfferStore.clearForScope(fixture.scope)

    expect(replaced.username).toBe('')
    expect(replaced.password).toBe('')
    expect(pendingLoginSaveOfferStore.findByScope(otherScope).state).toBe(
      PendingLoginSaveLookupState.Available,
    )
  })

  test('expiry and session reset clear credential references', () => {
    const fixture = new PendingLoginSaveFixture()
    const expired = fixture.offer(fixture.scope)
    expired.expiresAt = Date.now() - 1
    pendingLoginSaveOfferStore.store(expired)
    expect(pendingLoginSaveOfferStore.findByScope(fixture.scope).state).toBe(
      PendingLoginSaveLookupState.Unavailable,
    )
    expect(expired.password).toBe('')
    const active = fixture.offer(fixture.scope)
    pendingLoginSaveOfferStore.store(active)
    pendingLoginSaveOfferStore.clearAll()
    expect(active.username).toBe('')
    expect(active.password).toBe('')
  })
})
