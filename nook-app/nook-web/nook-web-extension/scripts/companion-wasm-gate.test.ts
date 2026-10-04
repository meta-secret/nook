import { rejects } from 'node:assert/strict'
import { afterEach, describe, expect, test } from 'bun:test'
import { companionWasmReadiness } from '../src/content/autofill/companion-wasm-readiness'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

import {
  queueSubmitCaptureUntilCompanionWasmReady,
  runAfterCompanionWasmReady,
} from '../src/content/autofill/companion-wasm-gate'

class ExtensionClassificationStartupFixture {
  private readonly chromeDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'chrome',
  )
  private readonly locationDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'location',
  )
  private respond: ((response: unknown) => void) | false = false

  install(): void {
    Object.assign(globalThis, {
      location: { origin: 'https://login.live.com' },
      chrome: {
        runtime: {
          sendMessage: (
            message: CompanionWasmRuntimeMessage,
            respond: (response: unknown) => void,
          ): void => {
            expect(message).toEqual({
              type: CompanionWasmSessionMessageType.ClassifyPageInputs,
              origin: 'https://login.live.com',
              payload: { fields: [], labels: [] },
            })
            this.respond = respond
          },
        },
      },
    })
  }

  deliver(response: unknown): void {
    if (!this.respond) throw new Error('No classification request pending.')
    this.respond(response)
  }

  uninstall(): void {
    if (this.chromeDescriptor)
      Object.defineProperty(globalThis, 'chrome', this.chromeDescriptor)
    else Reflect.deleteProperty(globalThis, 'chrome')
    if (this.locationDescriptor)
      Object.defineProperty(globalThis, 'location', this.locationDescriptor)
    else Reflect.deleteProperty(globalThis, 'location')
  }
}

describe('companion WASM startup gate', () => {
  const fixture = new ExtensionClassificationStartupFixture()
  afterEach(() => fixture.uninstall())
  test('queues submit events until runtime-backed classification is ready', () => {
    const events: Event[] = []
    const capture = queueSubmitCaptureUntilCompanionWasmReady((event) =>
      events.push(event),
    )
    const firstSubmit = new Event('submit')
    const secondSubmit = new Event('submit')

    capture.capture(firstSubmit)
    expect(events).toEqual([])
    capture.enable()
    expect(events).toEqual([firstSubmit])
    capture.capture(secondSubmit)
    expect(events).toEqual([firstSubmit, secondSubmit])
    capture.discard()
    capture.capture(new Event('submit'))
    expect(events).toEqual([firstSubmit, secondSubmit])
  })

  test('dispatches the initial observation before replaying a submit while later startup remains pending', async () => {
    const phases: string[] = []
    type PendingStartupOwner = { finish: (() => void) | false }
    const pendingOwner: PendingStartupOwner = { finish: false }
    const pending = new Promise<void>((resolve) => {
      pendingOwner.finish = resolve
    })
    const capture = queueSubmitCaptureUntilCompanionWasmReady(() =>
      phases.push('submit-captured'),
    )
    capture.capture(new Event('submit'))
    const scan = async () => {
      phases.push('field-request-dispatched')
      await pending
      phases.push('pending-step-completed')
    }
    const startup = runAfterCompanionWasmReady({
      companionWasmReady: Promise.resolve(),
      start: async () => {
        const observation = scan()
        capture.enable()
        await observation
      },
    })
    await Promise.resolve()
    expect(phases).toEqual(['field-request-dispatched', 'submit-captured'])
    if (!pendingOwner.finish) throw new Error('Missing pending startup owner')
    pendingOwner.finish()
    await startup
    expect(phases).toEqual([
      'field-request-dispatched',
      'submit-captured',
      'pending-step-completed',
    ])
  })

  test('holds the first Pilot startup until extension-owned classification responds', async () => {
    fixture.install()
    const events: string[] = []
    const startup = runAfterCompanionWasmReady({
      companionWasmReady:
        companionWasmReadiness.waitForExtensionClassification(),
      start: async () => {
        events.push('pilot-started')
      },
    })

    await Promise.resolve()
    expect(events).toEqual([])

    fixture.deliver({
      ok: true,
      result: {
        fields: [],
        labels: [],
        strongestAuthenticationUsernameEvidence: 'absent',
      },
    })
    await startup
    expect(events).toEqual(['pilot-started'])
  })

  test.each([
    { ok: false },
    { ok: true, result: { fields: [], labels: [] } },
    {
      ok: true,
      result: {
        fields: [],
        labels: [],
        strongestAuthenticationUsernameEvidence: 'explicit',
      },
    },
  ])(
    'does not start Pilot on unavailable or invalid classification readiness: %j',
    async (response) => {
      fixture.install()
      const events: string[] = []
      const startup = runAfterCompanionWasmReady({
        companionWasmReady:
          companionWasmReadiness.waitForExtensionClassification(),
        start: async () => {
          events.push('pilot-started')
        },
      })

      fixture.deliver(response)
      await rejects(
        startup,
        /Extension companion classification runtime unavailable/u,
      )
      expect(events).toEqual([])
    },
  )
})
