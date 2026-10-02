/** Owns lazy startup for legacy content runtime response decoders. */
class CompanionWasmReadiness {
  private ready = false

  async wait(): Promise<void> {
    const { companionWasmReady } =
      await import('../../../../nook-web-shared/src/extension/companion-ready')
    await companionWasmReady
    this.ready = true
  }

  isReadySynchronously(): boolean {
    return this.ready
  }
}

export const companionWasmReadiness = new CompanionWasmReadiness()
