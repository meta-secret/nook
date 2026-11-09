import type { VaultState } from "$lib/vault.svelte";
import { JoinEnrollmentState } from "$app-wasm";

/** Owns browser orchestration for one multi device context. */
export class VaultDeviceActions {
  constructor(private readonly state: VaultState) {}

  async refreshDeviceState() {
    const state = this.state;
    return state.manualSync();
  }

  async refreshPendingJoinsFromProviders() {
    const state = this.state;
    const rosterRefresh1 = await state.hydrateMultiDeviceState();
    if (rosterRefresh1.isErr()) {
      state.errorMsg = state.t(rosterRefresh1.error.translationKey);
      return;
    }
  }

  dismissJoinEnrollment() {
    const state = this.state;
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
  }
}
