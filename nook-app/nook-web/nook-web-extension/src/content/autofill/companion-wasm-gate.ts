type CompanionWasmGatedStartup = {
  readonly companionWasmReady: Promise<void>
  readonly start: () => Promise<void>
}

enum SubmitCaptureQueueKind {
  Waiting = 'waiting',
  Enabled = 'enabled',
  Discarded = 'discarded',
}

type SubmitCaptureQueueState =
  | { readonly kind: SubmitCaptureQueueKind.Waiting; readonly events: Event[] }
  | { readonly kind: SubmitCaptureQueueKind.Enabled }
  | { readonly kind: SubmitCaptureQueueKind.Discarded }

export type QueuedSubmitCapture = {
  readonly capture: (event: Event) => void
  readonly enable: () => void
  readonly discard: () => void
}

/** Starts content-script work only after the companion runtime is usable. */
export function runAfterCompanionWasmReady({
  companionWasmReady,
  start,
}: CompanionWasmGatedStartup): Promise<void> {
  return companionWasmReady.then(start)
}

/** Keeps native submit events in memory until runtime-backed classification is ready. */
export function queueSubmitCaptureUntilCompanionWasmReady(
  captureSubmittedLogin: (event: Event) => void,
): QueuedSubmitCapture {
  let state: SubmitCaptureQueueState = {
    kind: SubmitCaptureQueueKind.Waiting,
    events: [],
  }
  return {
    capture: (event) => {
      if (state.kind === SubmitCaptureQueueKind.Discarded) return
      if (state.kind === SubmitCaptureQueueKind.Enabled) {
        captureSubmittedLogin(event)
        return
      }
      state.events.push(event)
    },
    enable: () => {
      const current = state
      if (current.kind !== SubmitCaptureQueueKind.Waiting) return
      state = { kind: SubmitCaptureQueueKind.Enabled }
      for (const event of current.events) captureSubmittedLogin(event)
      current.events.length = 0
    },
    discard: () => {
      state = { kind: SubmitCaptureQueueKind.Discarded }
    },
  }
}
