<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { prepareICloudSignInControl } from "$lib/auth/icloud/oauth";
  import type { VaultState } from "$lib/vault.svelte";

  let { vault }: { vault: VaultState } = $props();

  let open = $state(false);
  let prepareStarted = $state(false);
  let prepareError = $state("");

  $effect(() => {
    if (!open || prepareStarted) return;
    prepareStarted = true;
    void prepareICloudSignInControl().catch((error) => {
      prepareError =
        error instanceof Error
          ? vault.t(error.message)
          : vault.t(I18N_KEYS.ProviderSetupIcloudSharedSignInFirst);
    });
  });
</script>

<div
  class="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3"
  data-testid="enrollment-icloud-auth"
>
  <button
    type="button"
    class="text-left text-xs font-medium text-primary hover:text-primary/80"
    aria-expanded={open}
    data-testid="enrollment-icloud-auth-toggle"
    onclick={() => {
      open = !open;
    }}
  >
    {vault.t(I18N_KEYS.LoginIcloudSharedEnrollmentToggle)}
  </button>
  {#if open}
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t(I18N_KEYS.LoginIcloudSharedEnrollmentHint)}
    </p>
    <div id="apple-sign-in-button"></div>
    <div id="apple-sign-out-button" class="hidden"></div>
    {#if prepareError}
      <p class="text-xs text-destructive">
        {prepareError}
      </p>
    {/if}
  {/if}
</div>
