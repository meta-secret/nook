<!--
Progress of the first-vault setup: name, then key. The name step is the
first screen, so the key step opens with it already checked; once the key
exists, setup is complete and the copy screen shows both checked. Keeping a
copy is offered there, not counted as a step, since it can be skipped.
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
    /** The step on screen; `Off` is the naming screen itself. */
    current: FirstRunStage;
  } = $props();

  // Backup sits past the last step: every step is done by then.
  const ORDER: readonly FirstRunStage[] = [
    FirstRunStage.Off,
    FirstRunStage.Protect,
    FirstRunStage.Backup,
  ];
  const steps = $derived([
    vault.t(I18N_KEYS.FirstRunStepName),
    vault.t(I18N_KEYS.FirstRunStepProtect),
  ]);
</script>

<StepProgress {steps} current={ORDER.indexOf(current)} />
