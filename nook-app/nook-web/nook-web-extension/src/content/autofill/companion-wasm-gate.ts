type CompanionWasmGatedStartup = {
  readonly companionWasmReady: Promise<void>
  readonly start: () => Promise<void>
}

/** Starts content-script work only after the companion runtime is usable. */
export function runAfterCompanionWasmReady({
  companionWasmReady,
  start,
}: CompanionWasmGatedStartup): Promise<void> {
  return companionWasmReady.then(start)
}
