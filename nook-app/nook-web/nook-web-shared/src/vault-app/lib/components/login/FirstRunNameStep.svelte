<!--
Setup creates a new identity: it is named here, on the sync provider signed
in to or on this browser only. Only its members see the name. Its first
vault takes the same name, so one field is enough.
-->
<script lang="ts">
  import { RefreshCw } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { FirstRunActions } from '$lib/vault/first-run'
  import { FirstRunPlace, FirstRunStage } from '$lib/vault/state/ui.svelte'

  let { vault }: { vault: VaultState } = $props()

  const actions = $derived(new FirstRunActions(vault))
  let name = $state('')
  // An empty field takes the suggested name, so one click is enough.
  const label = $derived(
    name.trim() || vault.t(I18N_KEYS.FirstRunNamePlaceholder),
  )
  const where = $derived(
    vault.firstRunPlace === FirstRunPlace.SyncProvider
      ? vault.t(I18N_KEYS.FirstRunNameOnProvider)
      : vault.t(I18N_KEYS.FirstRunNameOnBrowser),
  )
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

  <div class="space-y-2">
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
      data-testid="login-vault-name-input"
      bind:value={name}
      disabled={vault.isVerifying}
    />
    <Button
      type="submit"
      class="h-11 shrink-0 sm:h-10"
      disabled={vault.isVerifying}
      data-testid="login-create-device-vault-btn"
    >
      {#if vault.isVerifying}
        <RefreshCw class="size-4 animate-spin" />
      {/if}
      {vault.t(I18N_KEYS.FirstRunNameCreate)}
    </Button>
  </form>
  <p class="nk-spec" data-testid="first-run-name-place">{where}</p>
</section>
