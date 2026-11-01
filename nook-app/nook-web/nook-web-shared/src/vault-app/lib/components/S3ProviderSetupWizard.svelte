<!--
Setting up S3-compatible storage on the Sync page and the login screen: one
step with the S3 form and Connect & sync. A configuration Rust validated
becomes the S3 draft, then the host connects it; a failure the host reports
stays beside the form, where the user acted.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { S3Connection } from '$app-wasm'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import S3ConnectionPanel from '$lib/components/S3ConnectionPanel.svelte'
  import S3ProviderHeading from '$lib/components/S3ProviderHeading.svelte'
  import {
    S3ConnectAvailability,
    S3ConnectionAlertKind,
    S3ConnectionFailureKind,
    S3ConnectionFrame,
    S3ConnectionProgress,
    S3ConnectionSubmit,
    type S3ConnectionAlert,
  } from '$lib/components/s3-connection-form'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    idPrefix,
    isVerifying,
    isInitializing,
    connectDisabled = false,
    onCancelSetup,
    onConnect,
    beforeConnect,
  }: {
    vault: VaultState
    idPrefix: string
    isVerifying: boolean
    isInitializing: boolean
    /** The same gate the sibling wizards take: a question above Connect
     * is still unanswered. */
    connectDisabled?: boolean
    onCancelSetup: () => void
    onConnect: () => void | Promise<void>
    beforeConnect?: Snippet
  } = $props()

  const availability = $derived.by(() => {
    switch (connectDisabled) {
      case true:
        return S3ConnectAvailability.AwaitingRecoveryAnswer
      case false:
        return S3ConnectAvailability.Available
    }
  })

  let stepOpen = $state(true)
  /** This wizard's own attempt: the Sync page connects without a busy flag. */
  let attempt = $state<S3ConnectionProgress>(S3ConnectionProgress.Idle)
  let alert = $state.raw<S3ConnectionAlert>({
    kind: S3ConnectionAlertKind.None,
  })
  const progress = $derived.by(() => {
    if (isInitializing) return S3ConnectionProgress.LoadingEngine
    if (isVerifying) return S3ConnectionProgress.Connecting
    return attempt
  })

  async function connect(configuration: S3Connection): Promise<void> {
    alert = { kind: S3ConnectionAlertKind.None }
    const revision = vault.errorMsgRevision
    vault.configureS3(configuration)
    attempt = S3ConnectionProgress.Connecting
    try {
      await onConnect()
    } finally {
      attempt = S3ConnectionProgress.Idle
    }
    // The host takes over once the provider connects. A failure it
    // reported stays here, in its own words.
    if (vault.errorMsgRevision !== revision && vault.errorMsg)
      alert = {
        kind: S3ConnectionAlertKind.Shown,
        failure: S3ConnectionFailureKind.Other,
        message: vault.errorMsg,
      }
  }
</script>

{#snippet hostQuestion()}
  {@render beforeConnect?.()}
{/snippet}

<div class="space-y-4" data-testid="s3-setup">
  <S3ProviderHeading {vault} {progress} onChangeProvider={onCancelSetup} />
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
      frame={S3ConnectionFrame.Step}
      submit={S3ConnectionSubmit.ConnectAndSync}
      {progress}
      {availability}
      {alert}
      onConnect={connect}
      beforeConnect={hostQuestion}
    />
  </SetupWizardStep>
</div>
