<!--
Setting up S3-compatible storage on the Sync page and the login screen: one
step with the S3 form and Connect & sync. A configuration Rust validated
becomes the S3 draft, then the host connects it; a failure the host reports
stays beside the form, where the user acted.
-->
<script lang="ts">
  import { Archive, ShieldCheck } from '@lucide/svelte'
  import { s3_provider_draft, type S3Connection } from '$app-wasm'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import S3ConnectionPanel from '$lib/components/S3ConnectionPanel.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    idPrefix,
    isVerifying,
    isInitializing,
    onCancelSetup,
    onConnect,
  }: {
    vault: VaultState
    idPrefix: string
    isVerifying: boolean
    isInitializing: boolean
    onCancelSetup: () => void
    onConnect: () => void | Promise<void>
  } = $props()

  let stepOpen = $state(true)
  /** This wizard's own attempt: the Sync page connects without a busy flag. */
  let connecting = $state(false)
  /** The failure the host reported for the last attempt; empty if none. */
  let error = $state('')
  const busy = $derived(isInitializing || isVerifying || connecting)

  async function connect(configuration: S3Connection): Promise<void> {
    error = ''
    const revision = vault.errorMsgRevision
    vault.stageProviderDraft(s3_provider_draft(configuration))
    connecting = true
    try {
      await onConnect()
    } finally {
      connecting = false
    }
    // The host takes over once the provider connects. A failure it
    // reported stays here, in its own words.
    if (vault.errorMsgRevision !== revision && vault.errorMsg)
      error = vault.errorMsg
  }
</script>

<div class="space-y-4" data-testid="s3-setup">
  <div class="flex items-center gap-2 text-sm">
    <Archive class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span class="font-medium text-foreground"
      >{vault.t(I18N_KEYS.ProviderPickerS3)}</span
    >
    <button
      type="button"
      class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
      data-testid="cancel-provider-setup"
      disabled={busy}
      onclick={onCancelSetup}
    >
      {vault.t(I18N_KEYS.ProviderSetupChangeProvider)}
    </button>
  </div>
  <SetupWizardStep
    stepNumber={1}
    title={vault.t(I18N_KEYS.LoginWizardConnectionStep)}
    subtitle={vault.t(I18N_KEYS.ProviderSetupS3ConnectionSubtitle)}
    bind:open={stepOpen}
    testId="s3-setup-connection-step"
  >
    <S3ConnectionPanel
      {vault}
      {idPrefix}
      submitLabel={vault.t(I18N_KEYS.AuthStorageConnectAndSync)}
      submitIcon={ShieldCheck}
      submitTestId="connect-provider-btn"
      {busy}
      busyLabel={vault.t(
        isInitializing
          ? I18N_KEYS.OnboardingLoadingEngine
          : I18N_KEYS.AuthStorageSyncConnecting,
      )}
      {error}
      onConnect={connect}
    />
  </SetupWizardStep>
</div>
