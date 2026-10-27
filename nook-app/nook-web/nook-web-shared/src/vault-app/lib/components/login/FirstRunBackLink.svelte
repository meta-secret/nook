<!--
"Back" for the first-run steps: the app's square Back button on its own
line above the step progress, aligned with the content below it.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import BackButton from "$lib/components/workspace/BackButton.svelte";

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

<BackButton
  label={vault.t(I18N_KEYS.FirstRunBack)}
  {testId}
  {disabled}
  {onBack}
/>
