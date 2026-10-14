<!--
Progress of the first-vault setup: name, protect, back up. The name step is
the first screen, so the later steps open with it already checked.
-->
<script lang="ts">
  import { Check } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import { FirstRunStage } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    current,
  }: {
    vault: VaultState;
    /** The step on screen; `Off` is the naming screen itself. */
    current: FirstRunStage;
  } = $props();

  const ORDER: readonly FirstRunStage[] = [
    FirstRunStage.Off,
    FirstRunStage.Protect,
    FirstRunStage.Backup,
  ];
  const currentIndex = $derived(ORDER.indexOf(current));
  const steps = $derived([
    vault.t(I18N_KEYS.FirstRunStepName),
    vault.t(I18N_KEYS.FirstRunStepProtect),
    vault.t(I18N_KEYS.FirstRunStepBackup),
  ]);
</script>

<ol
  class="grid grid-cols-3 gap-2 font-mono text-[11px] tracking-[0.08em] uppercase"
  data-testid="first-run-progress"
>
  {#each steps as label, index (label)}
    <li
      class={[
        "flex items-center gap-1.5 border-t-2 pt-2",
        index < currentIndex
          ? "border-success text-success"
          : index === currentIndex
            ? "border-foreground text-foreground"
            : "border-border text-muted-foreground",
      ]}
      {...index === currentIndex ? { "aria-current": "step" } : {}}
    >
      {#if index < currentIndex}
        <Check class="size-3.5 shrink-0" aria-hidden="true" />
      {/if}
      <span class="truncate">{label}</span>
    </li>
  {/each}
</ol>
