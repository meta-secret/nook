import { afterEach, describe, expect, test, vi } from 'vitest'
import { NookPageInputClassifier } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmLabelKind,
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
  type CompanionWasmSessionResponse,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  PasswordFormScopeKind,
  passwordFieldDiscovery,
} from '../../../../nook-web-shared/src/extension/password-form-fields'
import { handleCompanionWasmMessage } from '../../../../nook-web-extension/src/offscreen/session-companion-wasm-operations'

type ClassificationReply =
  { ok: true; result: CompanionWasmSessionResponse } | { ok: false }

/** A content script's Chrome transport, connected to the real offscreen handler. */
class PageInputRuntime {
  readonly id = 'page-input-classification-test'
  readonly requests: CompanionWasmRuntimeMessage[] = []

  sendMessage(
    message: CompanionWasmRuntimeMessage,
    callback: (reply: ClassificationReply) => void,
  ): void {
    this.requests.push(message)
    void handleCompanionWasmMessage(message).then((result) => {
      result.match(
        (value) => callback({ ok: true, result: value }),
        () => callback({ ok: false }),
      )
    })
  }
}

/** The first form's advance control is associated by form ID, outside its subtree. */
function renderForms(): HTMLFormElement {
  document.body.innerHTML = `
    <form id="first">
      <input id="address" type="email" autocomplete="email" value="entered-fixture-value">
      <input id="ignored" disabled autocomplete="username">
    </form>
    <button form="first" type="submit">Continue</button>
    <form id="second">
      <input id="account" autocomplete="username">
      <input id="challenge" inputmode="numeric" autocomplete="one-time-code">
    </form>
  `
  const form = document.querySelector('#first')
  if (!(form instanceof HTMLFormElement)) throw new Error('expected first form')
  return form
}

function discoveredFields(owner: HTMLFormElement) {
  const root = document
  const scoped = {
    root,
    formScope: { kind: PasswordFormScopeKind.Owned, owner },
  } as const
  return {
    usernames: passwordFieldDiscovery
      .findUsernameFields({ root })
      .map((field) => field.id),
    codes: passwordFieldDiscovery
      .findOneTimeCodeFields({ root })
      .map((field) => field.id),
    scopedEvidence: passwordFieldDiscovery.usernameEvidence(scoped),
    pageEvidence: passwordFieldDiscovery.usernameEvidence({ root }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('page input classification boundaries', () => {
  test('direct and offscreen classification preserve ordered DOM fields and form-scoped evidence', async () => {
    vi.stubGlobal('chrome', undefined)
    const direct = discoveredFields(renderForms())
    expect(direct).toEqual({
      usernames: ['address', 'account'],
      codes: ['challenge'],
      scopedEvidence: 'strong',
      pageEvidence: 'explicit',
    })

    const runtime = new PageInputRuntime()
    vi.stubGlobal('chrome', { runtime })
    const directField = vi.spyOn(NookPageInputClassifier, 'classifyPageInput')
    const form = renderForms()
    expect(
      passwordFieldDiscovery.findUsernameFields({ root: document }),
    ).toEqual([])
    await passwordFieldDiscovery.prepareCompanionClassification(document)
    expect(discoveredFields(form)).toEqual(direct)
    expect(directField).not.toHaveBeenCalled()
    expect(runtime.requests).toHaveLength(1)
    const [message] = runtime.requests
    expect(message?.origin).toBe(location.origin)
    if (message?.type !== CompanionWasmSessionMessageType.ClassifyPageInputs)
      throw new Error('expected the indexed field batch')
    expect(message.payload.fields.map((field) => field.index)).toEqual([
      0, 1, 2, 3,
    ])
    expect(
      message.payload.fields[0]?.loginContextObservation.advanceControlLabel,
    ).toBe('Continue')
    expect(message.payload.fields[0]?.observation).not.toHaveProperty('value')
    expect(message.payload.labels).toContainEqual({
      kind: CompanionWasmLabelKind.LoginAdvance,
      value: 'Continue',
    })

    const address = form.querySelector('#address')
    if (!(address instanceof HTMLInputElement))
      throw new Error('expected email field')
    address.disabled = true
    await passwordFieldDiscovery.prepareCompanionClassification(document)
    expect(passwordFieldDiscovery.authenticationUsernameEvidence(address)).toBe(
      'absent',
    )
    expect(directField).not.toHaveBeenCalled()
  })

  test('the scalar operation uses supplied login context and the batch derives it from page observations', async () => {
    const email = renderForms().querySelector('#address')
    if (!(email instanceof HTMLInputElement))
      throw new Error('expected email field')
    const observation = {
      ...passwordFieldDiscovery.focusedFieldObservation(email),
      loginContext: true,
    }
    const loginContextObservation = {
      formIdentity: '',
      ancestorIdentities: [],
      advanceControlLabel: '',
      pathContext: '/catalog',
    }
    const scalar = await handleCompanionWasmMessage({
      type: CompanionWasmSessionMessageType.ClassifyPageInputField,
      payload: { observation },
    })
    const batch = await handleCompanionWasmMessage({
      type: CompanionWasmSessionMessageType.ClassifyPageInputs,
      payload: {
        fields: [{ index: 12, observation, loginContextObservation }],
        labels: [],
      },
    })
    expect(scalar._unsafeUnwrap()).toEqual({
      authenticationUsernameEvidence: 'strong',
      looksLikeUsernameField: true,
      looksLikeOneTimeCodeField: false,
    })
    expect(batch._unsafeUnwrap()).toMatchObject({
      fields: [
        {
          index: 12,
          loginContext: false,
          authenticationUsernameEvidence: 'standards-based-email',
        },
      ],
    })
  })

  test('the generated classifier rejects malformed field batches at the WASM boundary', () => {
    const malformed = { fields: [{}], labels: [] }
    expect(() => {
      Reflect.apply(
        NookPageInputClassifier.classifyPageInputs,
        NookPageInputClassifier,
        [malformed],
      )
    }).toThrow('Typed WASM value could not be converted.')
  })
})
