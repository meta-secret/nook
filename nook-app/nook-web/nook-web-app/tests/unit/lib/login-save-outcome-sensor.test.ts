import type { LoginSaveEvidenceKind } from '../../../../nook-web-extension/src/lib/login-save-observation-codecs'
import {
  CompanionWasmLabelKind,
  CompanionWasmSessionMessageType,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import * as companionRuntimeTransport from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
import { passwordFieldDiscovery } from '../../../../nook-web-shared/src/extension/password-forms'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Schema } from 'effect'
import { handleCompanionWasmMessage } from '../../../../nook-web-extension/src/offscreen/session-companion-wasm-operations'
import {
  LoginSaveNavigationMode,
  LoginSaveOutcomeSensor,
  type LoginSaveOutcomeSensorRequest,
} from '../../../../nook-web-extension/src/content/autofill/login-save-outcome-sensor'
import type {
  LoginSaveCaptureBaseline,
  LoginSaveCommitEvidence,
  LoginSaveOutcomeObservation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

vi.mock(
  '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport',
  async () => {
    const actual = await vi.importActual<
      typeof import('../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport')
    >(
      '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport',
    )
    const send: typeof actual.sendCompanionWasmRuntimeMessage = async (
      _browser,
      message,
    ) => {
      const result = await handleCompanionWasmMessage(message)
      return result.match(
        (response) => ({
          kind: actual.CompanionWasmRuntimeDeliveryKind.Delivered,
          response,
        }),
        () => ({ kind: actual.CompanionWasmRuntimeDeliveryKind.Unavailable }),
      )
    }
    return { ...actual, sendCompanionWasmRuntimeMessage: send }
  },
)

/** Uses the real Rust classifiers with a deterministic browser clock. */
class LoginSaveOutcomeFixture {
  readonly baseline: LoginSaveCaptureBaseline = {
    source: 'SubmittedLogin',
    submitted_at: 1000,
    submitted_url: location.href,
    captured_workflow: 0,
    initial_auth_fields: 'Present',
    controls: ['Sign in'],
  }
  sensor(nodes: readonly HTMLInputElement[]): LoginSaveOutcomeSensor {
    const request: LoginSaveOutcomeSensorRequest = {
      baseline: this.baseline,
      submittedNodes: nodes,
      navigationMode: LoginSaveNavigationMode.SameDocument,
    }
    return new LoginSaveOutcomeSensor(request)
  }
  async eligibility(sensor: LoginSaveOutcomeSensor): Promise<string> {
    const evidence = await sensor.collect()
    switch (evidence.kind) {
      case 'SubmittedLogin':
        return (await sensor.eligibility(evidence)).eligibility
      case 'ExplicitAuthentication':
        throw new Error('expected submitted login evidence')
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  document.body.replaceChildren()
})
afterEach(() => {
  const navigationState: Record<string, never> = {}
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  history.replaceState(navigationState, '', '/')
})

test('reads each shared ancestor style once and submits the current checkpoint text in DOM order', async () => {
  const root = document.createElement('main')
  root.innerHTML = [
    '<section id="first" aria-hidden="true">excluded directly<span>First</span><span>Second</span></section>',
    '<section><article id="siblings"></article></section>',
    '<section id="hidden" hidden><span>Revealed</span></section>',
    '<section inert><span>Inert</span></section>',
    '<section aria-disabled="true"><span>Disabled</span></section>',
    '<section style="display:none"><span>Display hidden</span></section>',
    '<section style="visibility:hidden"><span style="visibility:visible">Inherited hidden</span></section>',
    '<section style="overflow:clip;height:0px"><span>Clipped</span></section>',
    '<dialog><span>Closed</span></dialog><dialog open><span>Open</span></dialog>',
    '<script>Mock script</script><style>.fixture-unused {color: red}</style><template>Template text</template>',
  ].join('')
  document.body.append(root)
  const select = Schema.decodeUnknownSync(Schema.instanceOf(HTMLElement))
  const siblings = select(root.querySelector('#siblings'))
  const copies: string[] = []
  for (let index = 0; index < 32; index += 1) {
    const child = document.createElement('p')
    child.textContent = `Entry ${index}`
    copies.push(child.textContent)
    siblings.append(child)
  }
  const styleReads = vi.spyOn(window, 'getComputedStyle')
  const send = vi.spyOn(
    companionRuntimeTransport,
    'sendCompanionWasmRuntimeMessage',
  )

  await passwordFieldDiscovery.prepareCompanionClassification(root)
  const expectedFirst = ['First', 'Second', ...copies, 'Open'].join(' ')
  expect(send.mock.lastCall?.[1]).toMatchObject({
    type: CompanionWasmSessionMessageType.ClassifyPageInputs,
    payload: {
      labels: [
        {
          kind: CompanionWasmLabelKind.EmailVerificationBody,
          value: expectedFirst,
        },
      ],
    },
  })
  const styledElements = styleReads.mock.calls.map(([element]) => element)
  expect(styledElements).toHaveLength(new Set(styledElements).size)

  select(root.querySelector('#first')).hidden = true
  select(root.querySelector('#hidden')).hidden = false
  const untilFound = document.createElement('section')
  untilFound.setAttribute('hidden', 'until-found')
  const untilFoundText = document.createElement('span')
  untilFoundText.textContent = 'Hidden until found'
  untilFound.append(untilFoundText)
  root.append(untilFound)
  await passwordFieldDiscovery.prepareCompanionClassification(root)
  const expectedSecond = [...copies, 'Revealed', 'Open'].join(' ')
  expect(send.mock.lastCall?.[1]).toMatchObject({
    type: CompanionWasmSessionMessageType.ClassifyPageInputs,
    payload: {
      labels: [
        {
          kind: CompanionWasmLabelKind.EmailVerificationBody,
          value: expectedSecond,
        },
      ],
    },
  })
})

describe('submitted login fresh save evidence', () => {
  test('requires stable absence after navigation and still permits consent after the waiting budget', async () => {
    const fixture = new LoginSaveOutcomeFixture()
    const sensor = fixture.sensor([])
    const navigationState: Record<string, never> = {}
    history.replaceState(navigationState, '', '/account')
    expect(await fixture.eligibility(sensor)).toBe('Waiting')
    vi.setSystemTime(1750)
    expect(await fixture.eligibility(sensor)).toBe('Eligible')
    vi.setSystemTime(11000)
    expect(await fixture.eligibility(sensor)).toBe('Eligible')
    document.body.innerHTML = '<p role="alert">Incorrect password</p>'
    expect(await fixture.eligibility(sensor)).toBe('Rejected')
  })

  test('field removal alone waits; a newly classified authenticated control can corroborate a DOM-only transition', async () => {
    const fixture = new LoginSaveOutcomeFixture()
    const sensor = fixture.sensor([])
    sensor.sawMutation = true
    await sensor.collect()
    vi.setSystemTime(1750)
    expect(await fixture.eligibility(sensor)).toBe('Waiting')
    document.body.innerHTML = '<button>Sign out</button>'
    expect(await fixture.eligibility(sensor)).toBe('Eligible')
    fixture.baseline.controls = ['Sign out']
    expect(await fixture.eligibility(sensor)).toBe('Waiting')
  })

  test('hidden error and checkpoint templates do not veto; visible markers do', async () => {
    const fixture = new LoginSaveOutcomeFixture()
    const sensor = fixture.sensor([])
    const navigationState: Record<string, never> = {}
    history.replaceState(navigationState, '', '/account')
    document.body.innerHTML =
      '<section hidden><p role="alert">Incorrect password</p><div data-nook-manual-checkpoint>Verify your email</div><label><input type="checkbox">I am not a robot</label><iframe title="captcha"></iframe><input autocomplete="one-time-code"></section>'
    await sensor.collect()
    vi.setSystemTime(1750)
    expect(await fixture.eligibility(sensor)).toBe('Eligible')
    document.body.innerHTML = '<p role="alert">Incorrect password</p>'
    expect(await fixture.eligibility(sensor)).toBe('Rejected')
    document.body.innerHTML =
      '<div data-nook-manual-checkpoint>Verification required</div>'
    expect(await fixture.eligibility(sensor)).toBe('Waiting')
  })

  test('Chrome cached evidence queries the same rendered verification text it preloads', async () => {
    const fixture = new LoginSaveOutcomeFixture()
    const sensor = fixture.sensor([])
    const navigationState: Record<string, never> = {}
    history.replaceState(navigationState, '', '/account')
    const browserRuntime: { runtime: Pick<typeof chrome.runtime, 'id'> } = {
      runtime: { id: 'test-extension' },
    }
    vi.stubGlobal('chrome', browserRuntime)
    document.body.innerHTML =
      '<p hidden>Hidden template content</p><p>Please verify your email to continue</p>'
    const evidence = await sensor.collect()
    const expectedCheckpoint: {
      kind: Extract<
        LoginSaveCommitEvidence,
        { kind: `${LoginSaveEvidenceKind.SubmittedLogin}` }
      >['kind']
      observation: Pick<LoginSaveOutcomeObservation, 'checkpoint'>
    } = { kind: 'SubmittedLogin', observation: { checkpoint: 'Pending' } }
    expect(evidence).toMatchObject(expectedCheckpoint)
    expect(await fixture.eligibility(sensor)).toBe('Waiting')
    document.body.innerHTML =
      '<p hidden>Please verify your email to continue</p><p>Account dashboard</p>'
    const expectedClearCheckpoint: typeof expectedCheckpoint = {
      kind: 'SubmittedLogin',
      observation: { checkpoint: 'Clear' },
    }
    expect(await sensor.collect()).toMatchObject(expectedClearCheckpoint)
  })

  test('connected credential nodes remain authentication when disabled, readonly or shown', async () => {
    document.body.innerHTML =
      '<input id="submitted" type="password" autocomplete="current-password">'
    const field = Schema.decodeUnknownSync(Schema.instanceOf(HTMLInputElement))(
      document.querySelector('#submitted'),
    )
    const fixture = new LoginSaveOutcomeFixture()
    const sensor = fixture.sensor([field])
    field.disabled = true
    field.readOnly = true
    field.type = 'text'
    const navigationState: Record<string, never> = {}
    history.replaceState(navigationState, '', '/account')
    await sensor.collect()
    vi.setSystemTime(1750)
    expect(await fixture.eligibility(sensor)).toBe('Waiting')
  })

  test('fresh revealed replacement fields veto a prompt after the original fields disappear', async () => {
    const fixture = new LoginSaveOutcomeFixture()
    const sensor = fixture.sensor([])
    const navigationState: Record<string, never> = {}
    history.replaceState(navigationState, '', '/account')
    await sensor.collect()
    vi.setSystemTime(1750)
    document.body.innerHTML =
      '<input type="text" autocomplete="current-password" aria-label="Password">'
    const evidence = await sensor.collect()
    const expectedAuthentication: {
      kind: Extract<
        LoginSaveCommitEvidence,
        { kind: `${LoginSaveEvidenceKind.SubmittedLogin}` }
      >['kind']
      observation: {
        observation: Pick<
          LoginSaveOutcomeObservation['observation'],
          'authFieldsPresent'
        >
      }
    } = {
      kind: 'SubmittedLogin',
      observation: { observation: { authFieldsPresent: true } },
    }
    expect(evidence).toMatchObject(expectedAuthentication)
    expect(await fixture.eligibility(sensor)).toBe('Waiting')
  })

  test('recovered document retains its original baseline and starts a fresh absence interval', async () => {
    const fixture = new LoginSaveOutcomeFixture()
    const request: LoginSaveOutcomeSensorRequest = {
      baseline: fixture.baseline,
      submittedNodes: [],
      navigationMode: LoginSaveNavigationMode.DocumentNavigation,
    }
    const sensor = new LoginSaveOutcomeSensor(request)
    vi.setSystemTime(2000)
    expect(await fixture.eligibility(sensor)).toBe('Waiting')
    vi.setSystemTime(2750)
    expect(await fixture.eligibility(sensor)).toBe('Eligible')
    expect(sensor.request.baseline).toBe(fixture.baseline)
  })
})
