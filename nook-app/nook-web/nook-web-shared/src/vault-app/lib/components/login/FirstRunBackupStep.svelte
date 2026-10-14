<!--
Last step of the first-vault setup, shown once the vault exists. A sync
provider is added right here, inside the step; when it connects, or the
person skips, the new vault opens. Identity management is never visited.
-->
<script lang="ts">
  import { ArrowLeft, Copy } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import AuthStorage from "$lib/components/AuthStorage.svelte";
  import FirstRunProgress from "./FirstRunProgress.svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import { FirstRunStage } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    onReconnect,
    onDone,
  }: {
    vault: VaultState;
    onReconnect: () => void;
    /** Leave setup for the new vault. */
    onDone: () => void;
  } = $props();

  /** The picker and provider sign-in replace the offer while adding. */
  let choosing = $state(false);
  const providersBefore = untrack(() => vault.syncProviders.length);

  // A provider that connects finishes setup: the copy now exists.
  $effect(() => {
    if (choosing && vault.syncProviders.length > providersBefore) onDone();
  });

  function startChoosing(): void {
    choosing = true;
    vault.beginAddProvider();
  }

  function stopChoosing(): void {
    vault.cancelProviderSetup();
    vault.cancelAddProvider();
    choosing = false;
  }

  const body = $derived.by(() => {
    const bodyRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunBackupBody,
      replacements: { vault: vault.firstRunVaultName },
    };
    return vault.t(bodyRequest);
  });
</script>

<section
  class="mx-auto grid w-full max-w-2xl gap-6 py-6 sm:py-10"
  data-testid="first-run-backup-step"
>
  <div class="flex items-center gap-3">
    {#if choosing}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="-ml-2 size-9 shrink-0"
        aria-label={vault.t(I18N_KEYS.FirstRunBack)}
        title={vault.t(I18N_KEYS.FirstRunBack)}
        data-testid="first-run-backup-back"
        disabled={vault.isVerifying}
        onclick={stopChoosing}
      >
        <ArrowLeft class="size-4" />
      </Button>
    {/if}
    <div class="min-w-0 flex-1">
      <FirstRunProgress {vault} current={FirstRunStage.Backup} />
    </div>
  </div>

  <div class="space-y-3">
    {#if !choosing}
      <span class="nk-tile nk-tile-lg" aria-hidden="true">
        <Copy class="size-5" />
      </span>
    {/if}
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunBackupTitle)}
    </h1>
    <p class="max-w-[60ch] text-sm text-pretty text-muted-foreground">
      {body}
    </p>
  </div>

  {#if choosing}
    <div
      class="border border-border p-4 sm:p-5"
      data-testid="first-run-provider-picker"
    >
      <AuthStorage
        {vault}
        embedded
        syncProviders={vault.syncProviders}
        manualProviderSync={vault.manualProviderSync}
        isVerifying={vault.isVerifying}
        isInitializing={vault.isInitializing}
        addProviderOpen={vault.addProviderOpen}
        loginSetup={vault.loginSetup}
        bind:githubPat={vault.githubPat}
        bind:githubRepo={vault.githubRepo}
        {onReconnect}
        onCancelAddProvider={stopChoosing}
        onBeginSetup={(
          setupRequest: Parameters<typeof vault.beginProviderSetup>[0],
        ) => vault.beginProviderSetup(setupRequest)}
        onCancelSetup={() => vault.cancelProviderSetup()}
      />
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-3">
    {#if !choosing}
      <Button
        type="button"
        data-testid="first-run-backup-btn"
        onclick={startChoosing}
      >
        {vault.t(I18N_KEYS.FirstRunBackupCta)}
      </Button>
    {/if}
    <Button
      type="button"
      variant="ghost"
      data-testid="first-run-backup-skip"
      disabled={vault.isVerifying}
      onclick={() => {
        if (choosing) stopChoosing();
        onDone();
      }}
    >
      {vault.t(I18N_KEYS.FirstRunBackupSkip)}
    </Button>
  </div>
</section>
