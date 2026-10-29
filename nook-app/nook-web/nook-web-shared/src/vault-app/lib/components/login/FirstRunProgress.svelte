<!--
Progress of first-run setup: the passkey, the sync provider, the identity on
it, then its first vault. Naming a new identity and waiting for a join are
both the identity step; once the first vault connects its provider, every
step is done.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import { FirstRunStage } from "$lib/vault/state/ui.svelte";
  import StepProgress from "./StepProgress.svelte";

  let {
    vault,
    current,
  }: {
    vault: VaultState;
    /** The stage on screen. */
    current: FirstRunStage;
  } = $props();

  const steps = $derived([
    vault.t(I18N_KEYS.FirstRunStepProtect),
    vault.t(I18N_KEYS.FirstRunStepSync),
    vault.t(I18N_KEYS.FirstRunStepIdentity),
    vault.t(I18N_KEYS.FirstRunStepVault),
  ]);

  function stepOf(stage: FirstRunStage): number {
    switch (stage) {
      case FirstRunStage.Off:
      case FirstRunStage.Protect:
        return 0;
      case FirstRunStage.Sync:
        return 1;
      case FirstRunStage.Name:
      case FirstRunStage.Joining:
        return 2;
      case FirstRunStage.Vault:
        return 3;
      case FirstRunStage.Connect:
        return 4;
    }
  }
</script>

<StepProgress {steps} current={stepOf(current)} />
