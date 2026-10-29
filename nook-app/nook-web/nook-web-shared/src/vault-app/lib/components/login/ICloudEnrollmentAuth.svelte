<!--
The iCloud sign-in an invite kept in iCloud needs. The join screen shows it
only once the join reaches that invite: Apple's control is prepared here,
the person signs in with it, then joins again.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { iCloudOAuthSession } from '$lib/auth/icloud/oauth'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()

  let attempt = $state(0)
  let prepareError = $state('')

  $effect(() => {
    void attempt
    prepareError = ''
    void iCloudOAuthSession
      .prepareICloudSignInControl()
      .then((prepared) => {
        if (prepared.isErr()) {
          prepareError = vault.t(prepared.error.translationKey)
        }
      })
      .catch((error) => {
        prepareError =
          error instanceof Error
            ? vault.t(error.message)
            : vault.t(I18N_KEYS.ProviderSetupIcloudSharedSignInFirst)
      })
  })
</script>

<div
  class="space-y-2 border border-border bg-card p-3"
  data-testid="enrollment-icloud-auth"
>
  <p class="text-xs text-pretty text-muted-foreground">
    {vault.t(I18N_KEYS.LoginIcloudSharedEnrollmentHint)}
  </p>
  <div id="apple-sign-in-button"></div>
  <div id="apple-sign-out-button" class="hidden"></div>
  {#if prepareError}
    <p class="text-xs text-destructive">{prepareError}</p>
    <button
      type="button"
      class="text-xs font-medium text-foreground underline underline-offset-4"
      data-testid="enrollment-icloud-auth-retry"
      onclick={() => (attempt += 1)}
    >
      {vault.t(I18N_KEYS.LoginIcloudSharedEnrollmentRetry)}
    </button>
  {/if}
</div>
