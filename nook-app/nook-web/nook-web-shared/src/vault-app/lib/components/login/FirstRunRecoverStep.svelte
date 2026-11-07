<!--
Setup joins a keyring on the sync provider with one of its recovery
passphrases instead of asking its devices. Accepted, this browser's key
joins the keyring and setup ends on it, as after an approved join.
-->
<script lang="ts">
  import { Lock } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import RecoveryWordsForm from '$lib/components/recovery-passphrase/RecoveryWordsForm.svelte'
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { FirstRunActions } from '$lib/vault/first-run'
  import type { IdentityJoinIntent } from '$lib/vault/identity-join-wait'
  import { FirstRunStage } from '$lib/vault/state/ui.svelte'
  import {
    RecoveryWordsLeaveKind,
    type RecoveryWordsLeave,
  } from '$lib/components/recovery-passphrase/recovery-passphrase-state'

  let { vault, join }: { vault: VaultState; join: IdentityJoinIntent } =
    $props()

  const actions = $derived(new FirstRunActions(vault))
  let working = $state(false)
  const busy = $derived(working || vault.isVerifying)
  // Setup's own Back above the step leaves the words.
  const leave: RecoveryWordsLeave = { kind: RecoveryWordsLeaveKind.Elsewhere }
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-recover-step"
>
  <div class="grid gap-4">
    <FirstRunBackLink
      {vault}
      testId="first-run-recover-back"
      disabled={busy}
      onBack={() => actions.backToSync()}
    />
    <FirstRunProgress {vault} current={FirstRunStage.Joining} />
  </div>

  <div class="space-y-2">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.RecoveryPassphraseRecoverTitle)}
    </h1>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.RecoveryPassphraseRecoverBody)}
    </p>
  </div>

  <div class="nk-frame flex items-center gap-3 px-4 py-3">
    <span class="nk-tile nk-tile-sm" aria-hidden="true">
      <Lock class="size-4" />
    </span>
    <p
      class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
      data-testid="first-run-recover-identity"
    >
      {join.label}
    </p>
  </div>

  <RecoveryWordsForm
    {vault}
    {join}
    connect={() => actions.connectProvider()}
    {leave}
    bind:working
  />
</section>
