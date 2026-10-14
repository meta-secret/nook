<!--
"Back" for the first-run steps: a labelled text link on its own line above
the step progress, aligned with the content below it.
-->
<script lang="ts">
  import { ArrowLeft } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";

  let {
    vault,
    testId,
    disabled = false,
    onBack,
  }: {
    vault: VaultState;
    testId: string;
    disabled?: boolean;
    onBack: () => void;
  } = $props();
</script>

<button
  type="button"
  class="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
  data-testid={testId}
  {disabled}
  onclick={onBack}
>
  <ArrowLeft class="size-4" aria-hidden="true" />
  {vault.t(I18N_KEYS.FirstRunBack)}
</button>
