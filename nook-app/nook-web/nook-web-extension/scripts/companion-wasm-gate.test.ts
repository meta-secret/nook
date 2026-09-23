import { rejects } from 'node:assert/strict'
import { describe, expect, test } from 'bun:test'

import {
  queueSubmitCaptureUntilCompanionWasmReady,
  runAfterCompanionWasmReady,
} from '../src/content/autofill/companion-wasm-gate'

type Deferred = {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (reason: Error) => void
}

function deferred(): Deferred {
  let resolvePromise: () => void = () => {}
  let rejectPromise: (reason: Error) => void = () => {}
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = (reason) => reject(reason)
  })
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

describe('companion WASM startup gate', () => {
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

  test('holds the first Pilot startup until companion WASM is ready', async () => {
    const readiness = deferred()
    const events: string[] = []
    const startup = runAfterCompanionWasmReady({
      companionWasmReady: readiness.promise,
      start: async () => {
        events.push('pilot-started')
      },
    })

    await Promise.resolve()
    expect(events).toEqual([])

    readiness.resolve()
    await startup
    expect(events).toEqual(['pilot-started'])
  })

  test('does not start Pilot and preserves companion WASM rejection', async () => {
    const readiness = deferred()
    const events: string[] = []
    const failure = new Error('companion WASM failed')
    const startup = runAfterCompanionWasmReady({
      companionWasmReady: readiness.promise,
      start: async () => {
        events.push('pilot-started')
      },
    })

    readiness.reject(failure)
    await rejects(startup, (error: unknown) => error === failure)
    expect(events).toEqual([])
  })
})
