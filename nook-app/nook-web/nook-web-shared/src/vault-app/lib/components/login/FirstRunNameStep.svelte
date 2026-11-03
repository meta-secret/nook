<!--
Setup creates a new identity: it is named here, on the sync provider signed
in to or on this browser only. Only its members see the name. Kept on this
browser, it asks next whether to create a first vault.
-->
<script lang="ts">
  import {
    Archive,
    Cloud,
    MonitorSmartphone,
    RefreshCw,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { FirstRunActions } from '$lib/vault/first-run'
  import {
    FirstRunPlace,
    FirstRunStage,
    FirstRunSyncSource,
  } from '$lib/vault/state/ui.svelte'

  let { vault }: { vault: VaultState } = $props()

  const actions = $derived(new FirstRunActions(vault))
  let name = $state('')
  // An empty field takes the suggested name, so one click is enough.
  const label = $derived(
    name.trim() || vault.t(I18N_KEYS.FirstRunNamePlaceholder),
  )
  const onProvider = $derived(
    vault.firstRunPlace === FirstRunPlace.SyncProvider,
  )
  const syncSource = $derived(actions.syncSource())
  const where = $derived.by(() => {
    switch (vault.firstRunPlace) {
      case FirstRunPlace.ThisBrowser:
        return vault.t(I18N_KEYS.FirstRunNameOnBrowser)
      case FirstRunPlace.SyncProvider:
        return providerPlace()
    }
  })

  /** The sync provider the identity is kept on, as the line names it. */
  function providerPlace(): string {
    switch (syncSource) {
      case FirstRunSyncSource.GoogleDrive:
        return vault.t(I18N_KEYS.FirstRunNameOnProvider)
      case FirstRunSyncSource.S3: {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.FirstRunNameOnS3,
          replacements: { location: vault.stagedProviderLabel() },
        }
        return vault.t(request)
      }
    }
  }
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-name-step"
>
  <div class="grid gap-4">
    <FirstRunBackLink
      {vault}
      testId="first-run-name-back"
      disabled={vault.isVerifying}
      onBack={() => actions.backToSync()}
    />
    <FirstRunProgress {vault} current={FirstRunStage.Name} />
  </div>

  <div class="space-y-2 text-center">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunNameTitle)}
    </h1>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunNameBody)}
    </p>
  </div>


  <form
    class="flex flex-col gap-2 sm:flex-row"
    onsubmit={(event) => {
      event.preventDefault()
      void actions.createNamed(label)
    }}
  >
    <label class="sr-only" for="first-vault-name">
      {vault.t(I18N_KEYS.FirstRunNameLabel)}
    </label>
    <input
      id="first-vault-name"
      type="text"
      class="h-11 min-w-0 border border-border bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:flex-1"
      placeholder={vault.t(I18N_KEYS.FirstRunNamePlaceholder)}
      maxlength="64"
      autocomplete="off"
      data-testid="first-run-identity-name-input"
      bind:value={name}
      disabled={vault.isVerifying}
    />
    <Button
      type="submit"
      class="h-11 shrink-0 sm:h-10"
      disabled={vault.isVerifying}
      data-testid="first-run-identity-create-btn"
    >
      {#if vault.isVerifying}
        <RefreshCw class="size-4 animate-spin" />
      {/if}
      {vault.t(I18N_KEYS.FirstRunNameCreate)}
    </Button>
  </form>
  <p
    class="nk-spec flex items-center justify-center gap-2"
    data-testid="first-run-name-place"
  >
    {#if onProvider && syncSource === FirstRunSyncSource.S3}
      <Archive class="size-3.5" aria-hidden="true" />
    {:else if onProvider}
      <Cloud class="size-3.5" aria-hidden="true" />
    {:else}
      <MonitorSmartphone class="size-3.5" aria-hidden="true" />
    {/if}
    {where}
  </p>
</section>
