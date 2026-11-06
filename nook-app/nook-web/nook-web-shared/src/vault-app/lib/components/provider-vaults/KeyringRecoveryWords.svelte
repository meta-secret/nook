<!--
A keyring listed on a sync provider, recovered with one of its recovery
passphrases: this browser's fresh key exists, so its words are typed here
in place of the list. Accepted, the page connects the provider its own way;
Back returns to the list and joins nothing.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Lock } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import RecoveryWordsForm from '$lib/components/recovery-passphrase/RecoveryWordsForm.svelte'
  import FirstRunBackLink from '$lib/components/login/FirstRunBackLink.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    KeyringRecoveryKind,
    type IdentityJoinIntent,
  } from '$lib/vault/identity-join-wait'

  let {
    vault,
    join,
    connect,
  }: {
    vault: VaultState
    join: IdentityJoinIntent
    /** Connects the sync provider once the words let this browser in;
     * true when it connected. */
    connect: () => Promise<boolean>
  } = $props()

  let working = $state(false)

  // Leaving the page leaves the recovery: the list shows when it returns.
  onDestroy(() => {
    vault.keyringRecovery = { kind: KeyringRecoveryKind.None }
  })
</script>

<section class="grid gap-4" data-testid="keyring-recovery-words">
  <FirstRunBackLink
    {vault}
    testId="keyring-recovery-back"
    disabled={working || vault.isVerifying}
    onBack={() => (vault.keyringRecovery = { kind: KeyringRecoveryKind.None })}
  />
  <div class="space-y-1">
    <p class="text-sm font-medium text-foreground">
      {vault.t(I18N_KEYS.RecoveryPassphraseRecoverTitle)}
    </p>
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
      data-testid="keyring-recovery-identity"
    >
      {join.label}
    </p>
  </div>
  <RecoveryWordsForm {vault} {join} {connect} bind:working />
</section>
