<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { PasswordStrengthLevel, password_strength_level } from "$app-wasm";
  import type { VaultState } from "$lib/vault.svelte";
  import { StrengthMeterView } from "./strength-meter";

  let { value, vault }: { value: string; vault: VaultState } = $props();

  const view = $derived(new StrengthMeterView(password_strength_level(value)));
  const levelLabel = $derived(
    view.level === PasswordStrengthLevel.Weak
      ? vault.t(I18N_KEYS.VaultStrengthWeak)
      : view.level === PasswordStrengthLevel.Fair
        ? vault.t(I18N_KEYS.VaultStrengthFair)
        : vault.t(I18N_KEYS.VaultStrengthStrong),
  );
  const summary = $derived.by(() => {
    const summaryArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.VaultStrengthSummary,
      replacements: { count: String([...value].length), level: levelLabel },
    };
    return vault.t(summaryArgs);
  });
</script>

<div
  class="nk-meter"
  data-level={view.tone}
  data-testid="secret-strength-meter"
  title={vault.t(I18N_KEYS.VaultStrengthHint)}
>
  <span class="nk-meter-segments" aria-hidden="true">
    {#each view.segments as on, index (index)}
      <i data-on={on}></i>
    {/each}
  </span>
  <span>{summary}</span>
</div>
