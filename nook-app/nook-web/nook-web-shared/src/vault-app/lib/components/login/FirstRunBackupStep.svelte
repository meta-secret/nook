<!--
Shown once the first vault exists: setup is done, and keeping a copy is
recommended, not required. A sync provider is added right here; when it
connects, or the person declines, the new vault opens. Identity management
is never visited.
-->
<script lang="ts">
  import { CheckCircle2 } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import AuthStorage from "$lib/components/AuthStorage.svelte";
  import FirstRunBackLink from "./FirstRunBackLink.svelte";
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

  const title = $derived.by(() => {
    const titleRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunBackupTitle,
      replacements: { vault: vault.firstRunVaultName },
    };
    return vault.t(titleRequest);
  });
</script>

<section
  class="mx-auto grid w-full max-w-2xl gap-6 py-6 sm:py-10"
  data-testid="first-run-backup-step"
>
  <div class="grid gap-4">
    {#if choosing}
      <FirstRunBackLink
        {vault}
        testId="first-run-backup-back"
        disabled={vault.isVerifying}
        onBack={stopChoosing}
      />
    {/if}
    <FirstRunProgress {vault} current={FirstRunStage.Backup} />
  </div>

  <div class="space-y-3">
    {#if !choosing}
      <span class="nk-tile nk-tile-lg" aria-hidden="true">
        <CheckCircle2 class="size-5 text-success" />
      </span>
    {/if}
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {title}
    </h1>
    <p class="max-w-[60ch] text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunBackupBody)}
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
