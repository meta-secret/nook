<!--
Ways to reach a vault that already exists. Joining the identity from another
app is the usual path for a second device; restoring from a sync provider is
the recovery path when no other app is at hand.
-->
<script lang="ts">
  import { VaultWorkspaceActions } from "$lib/vault/ui";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { ArrowRight, Cloud, QrCode } from "@lucide/svelte";
  import LoginEnrollmentPanel from "$lib/components/login/LoginEnrollmentPanel.svelte";
  import type { EnrollmentCodeUnlock } from "./login-create-vault-chooser-contract";
  import type { VaultState } from "$lib/vault.svelte";

  let {
    vault,
    isBusy,
    isVerifying,
    restoreDescription,
    onConnectStorage,
    onUseEnrollmentCode,
  }: {
    vault: VaultState;
    isBusy: boolean;
    isVerifying: boolean;
    restoreDescription: string;
    onConnectStorage: () => void;
    /** Present when this app can join an identity with an enrollment code. */
    onUseEnrollmentCode?: (code: EnrollmentCodeUnlock) => void | Promise<void>;
  } = $props();

  // The code panel replaces the join button; collapsing it brings the
  // button back.
  let joinOpen = $state(false);
</script>

<div class="pt-5 pl-11" data-testid="login-path-cloud">
  <div
    class="mb-3 flex items-center gap-3 text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
  >
    <span class="text-center text-xs">
      {vault.t(I18N_KEYS.LoginExistingVaultAlternative)}
    </span>
  </div>
  <div class="grid gap-2">
    {#if onUseEnrollmentCode && joinOpen}
      <LoginEnrollmentPanel
        {vault}
        bind:open={joinOpen}
        {isVerifying}
        {onUseEnrollmentCode}
      />
    {:else if onUseEnrollmentCode}
      <button
        type="button"
        class="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 nk-frame-nick nk-frame-interactive px-4 py-3 text-left text-foreground transition-colors hover:bg-accent/40 disabled:opacity-60"
        data-testid="login-join-identity-btn"
        disabled={isBusy}
        onclick={() => (joinOpen = true)}
      >
        <span class="nk-tile">
          <QrCode class="size-4" />
        </span>
        <span class="min-w-0">
          <span class="block text-sm font-semibold">
            {vault.t(I18N_KEYS.LoginJoinDevice)}
          </span>
          <span class="mt-1 block text-xs leading-snug text-muted-foreground">
            {vault.t(I18N_KEYS.LoginPathJoinDescription)}
          </span>
        </span>
        <ArrowRight
          class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </button>
    {/if}
    <button
      type="button"
      class="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 nk-frame-nick nk-frame-interactive px-4 py-3 text-left text-foreground transition-colors hover:bg-accent/40 disabled:opacity-60"
      data-testid="login-connect-storage-btn"
      disabled={isBusy}
      onclick={onConnectStorage}
    >
      <span class="nk-tile">
        <Cloud class="size-4" />
      </span>
      <span class="min-w-0">
        <span class="block text-sm font-semibold">
          {vault.t(I18N_KEYS.LoginPathCloudTitle)}
        </span>
        <span class="mt-1 block text-xs leading-snug text-muted-foreground">
          {restoreDescription}
        </span>
      </span>
      <ArrowRight
        class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </button>
  </div>
  <div class="mt-3 flex justify-center text-sm">
    <button
      type="button"
      class="text-balance text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground"
      data-testid="login-access-check-link"
      onclick={() => new VaultWorkspaceActions(vault).openAccessCheck()}
    >
      {vault.t(I18N_KEYS.AccessCheckEntryLink)}
    </button>
  </div>
</div>
