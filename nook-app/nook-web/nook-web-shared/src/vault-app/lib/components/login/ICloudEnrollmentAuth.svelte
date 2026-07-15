<script lang="ts">
  import { prepareICloudSignInControl } from "$lib/icloud-oauth";
  import type { VaultState } from "$lib/vault.svelte";

  let { vault }: { vault: VaultState } = $props();

  let open = $state(false);
  let prepareStarted = $state(false);
  let prepareError = $state("");

  $effect(() => {
    if (!open || prepareStarted) return;
    prepareStarted = true;
    void prepareICloudSignInControl().catch((error: unknown) => {
      prepareError =
        error instanceof Error
          ? error.message
          : vault.t("provider_setup.icloud_shared_sign_in_first");
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
    {vault.t("login.icloud_shared_enrollment_toggle")}
  </button>
  {#if open}
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t("login.icloud_shared_enrollment_hint")}
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
