/** Owns lazy startup for legacy content runtime response decoders. */
class CompanionWasmReadiness {
  async wait(): Promise<void> {
    const { companionWasmReady } =
      await import('../../../../nook-web-shared/src/extension/companion-ready')
    await companionWasmReady
  }
}

export const companionWasmReadiness = new CompanionWasmReadiness()
