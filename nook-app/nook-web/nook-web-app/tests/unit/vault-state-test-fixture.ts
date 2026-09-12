import { VaultState } from '$lib/vault.svelte'

/** Owns WASM-safe construction of the real reactive vault state in unit tests. */
export class VaultStateTestFixture {
  static create(): VaultState {
    return this.createFrom(VaultState)
  }

  static createFrom<State extends VaultState>(
    StateConstructor: new () => State,
  ): State {
    const windowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'window',
    )
    Reflect.deleteProperty(globalThis, 'window')
    try {
      return new StateConstructor()
    } finally {
      if (windowDescriptor)
        Object.defineProperty(globalThis, 'window', windowDescriptor)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  }
}
