import { VaultState } from '$lib/vault.svelte'
import type { Result } from 'neverthrow'

/** Owns WASM-safe construction of the real reactive vault state in unit tests. */
export class VaultStateTestFixture {
  static create(): VaultState {
    return this.createFrom(VaultState)
  }

  static createFrom<State extends VaultState>(
    StateConstructor: new () => State,
  ): State {
    return new StateConstructor()
  }

  static runStorageImmediately(state: VaultState): void {
    state.enqueueStorage = async <Value, Failure>(
      operation: () => Result<Value, Failure> | Promise<Result<Value, Failure>>,
    ): Promise<Result<Value, Failure>> => operation()
  }
}
