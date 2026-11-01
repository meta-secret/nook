<!--
The S3 setup form: endpoint, region, bucket, an optional key prefix, the
access key ID and the secret access key, then one action. Rust validates the
whole form at once and names each wrong field; the form only shows what it
says. The secret is a password input with no reveal, and the typed values
live in this component until it unmounts. Inputs have no name, so a native
submission could never carry them into a URL.
-->
<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte'
  import { RefreshCw, ShieldCheck, TriangleAlert } from '@lucide/svelte'
  import {
    validate_s3_connection_draft,
    type S3ConnectionDraft,
    type S3DraftField,
    type S3Connection,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import {
    S3ConnectAvailability,
    S3ConnectionAlertKind,
    S3ConnectionFailureKind,
    S3ConnectionForm,
    S3ConnectionFrame,
    S3ConnectionProgress,
    S3ConnectionSubmit,
    S3FieldPlaceholderKind,
    S3FieldRequirement,
    S3FieldRole,
    S3InputType,
    type S3ConnectionAlert,
    type S3FieldErrors,
    type S3FormField,
  } from '$lib/components/s3-connection-form'
  import type { VaultState } from '$lib/vault.svelte'

  type S3InputEvent = Event & {
    readonly currentTarget: EventTarget & HTMLInputElement
  }

  let {
    vault,
    idPrefix,
    frame,
    submit,
    progress,
    availability,
    alert,
    onConnect,
    beforeConnect,
  }: {
    vault: VaultState
    idPrefix: string
    frame: S3ConnectionFrame
    submit: S3ConnectionSubmit
    progress: S3ConnectionProgress
    availability: S3ConnectAvailability
    alert: S3ConnectionAlert
    onConnect: (configuration: S3Connection) => void | Promise<void>
    beforeConnect?: Snippet
  } = $props()

  let draft = $state<S3ConnectionDraft>({
    endpoint: '',
    region: '',
    bucket: '',
    keyPrefix: '',
    accessKeyId: '',
    secretAccessKey: '',
  })
  let fieldErrors = $state.raw<S3FieldErrors>([])
  const form = $derived(new S3ConnectionForm(idPrefix))
  const pending = $derived(progress !== S3ConnectionProgress.Idle)
  const refused = $derived(
    alert.kind === S3ConnectionAlertKind.Shown &&
      alert.failure === S3ConnectionFailureKind.AccessDenied,
  )
  const frameClass = $derived.by(() => {
    switch (frame) {
      case S3ConnectionFrame.Panel:
        return 'nk-panel min-w-0 space-y-4 p-4 sm:p-5'
      case S3ConnectionFrame.Step:
        return 'min-w-0 space-y-4'
    }
  })
  const action = $derived.by(() => {
    switch (submit) {
      case S3ConnectionSubmit.Connect:
        return {
          testId: 'first-run-s3-connect',
          label: I18N_KEYS.CommonConnect,
          pending: I18N_KEYS.CommonConnecting,
        }
      case S3ConnectionSubmit.ConnectAndSync:
        return {
          testId: 'connect-provider-btn',
          label: I18N_KEYS.AuthStorageConnectAndSync,
          pending: I18N_KEYS.AuthStorageSyncConnecting,
        }
    }
  })

  function placeholder(field: S3FormField): string {
    switch (field.placeholder.kind) {
      case S3FieldPlaceholderKind.Sample:
        return vault.t(field.placeholder.key)
      case S3FieldPlaceholderKind.None:
        return ''
    }
  }

  /** The ids that describe one input: its error, the secret's note, and
   * the alert a refused key points the key inputs at. */
  function describedBy(field: S3FormField): string {
    const ids: string[] = []
    if (fieldErrors.some((error) => error.field === field.name))
      ids.push(form.errorId(field))
    switch (field.type) {
      case S3InputType.Password:
        ids.push(form.noteId)
        break
      case S3InputType.Text:
        break
    }
    switch (field.role) {
      case S3FieldRole.Key:
        if (refused) ids.push(form.alertId)
        break
      case S3FieldRole.Location:
        break
    }
    return ids.join(' ')
  }

  /** The input handler of one field: it keeps the value and drops that
   * field's error, so a corrected field stops saying it is wrong. */
  function editing(field: S3FormField): (event: S3InputEvent) => void {
    return (event) => {
      draft[field.name] = event.currentTarget.value
      fieldErrors = fieldErrors.filter((error) => error.field !== field.name)
    }
  }

  function focusInput(name: S3DraftField): void {
    const field = S3ConnectionForm.FIELDS.find(
      (candidate) => candidate.name === name,
    )
    if (!field) return
    const input = document.getElementById(form.inputId(field))
    if (input instanceof HTMLInputElement) input.focus()
  }

  async function connect(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const validation = validate_s3_connection_draft($state.snapshot(draft))
    switch (validation.state) {
      case 'invalid': {
        fieldErrors = validation.fields
        await tick()
        const [first] = validation.fields
        if (first) focusInput(first.field)
        return
      }
      case 'valid':
        fieldErrors = []
        await onConnect(validation.configuration)
        return
    }
  }

  onMount(() => focusInput('endpoint'))
</script>

<form novalidate class="space-y-4" aria-busy={pending} onsubmit={connect}>
  <fieldset class={frameClass}>
    <legend class="sr-only">{vault.t(I18N_KEYS.ProviderPickerS3)}</legend>
    <div class="grid gap-4 sm:grid-cols-2">
      {#each S3ConnectionForm.FIELDS as field (field.name)}
        {@const error = fieldErrors.find(
          (candidate) => candidate.field === field.name,
        )}
        {@const keyRefused = refused && field.role === S3FieldRole.Key}
        <div class="min-w-0 space-y-1.5 {field.width}">
          <div class="flex items-baseline justify-between gap-2">
            <label class="nk-field-label" for={form.inputId(field)}>
              {vault.t(field.label)}
            </label>
            {#if field.requirement === S3FieldRequirement.Optional}
              <span class="nk-tag text-muted-foreground">
                {vault.t(I18N_KEYS.CommonOptional)}
              </span>
            {/if}
          </div>
          <input
            id={form.inputId(field)}
            type={field.type}
            inputmode={field.inputMode}
            value={draft[field.name]}
            placeholder={placeholder(field)}
            autocomplete="off"
            spellcheck="false"
            autocapitalize="none"
            disabled={pending}
            aria-invalid={Boolean(error) || keyRefused}
            aria-describedby={describedBy(field)}
            data-testid="s3-{field.slug}-input"
            class="flex h-11 w-full rounded-none border bg-background px-3 font-mono text-sm sm:h-10 focus:outline-hidden focus:border-foreground/40 focus:ring-2 focus:ring-ring disabled:opacity-60"
            class:border-input={!error}
            class:border-destructive={Boolean(error)}
            oninput={editing(field)}
          />
          {#if field.type === S3InputType.Password}
            <p id={form.noteId} class="text-xs text-muted-foreground">
              {vault.t(I18N_KEYS.ProviderSetupS3SecretNote)}
            </p>
          {/if}
          {#if error}
            <p
              id={form.errorId(field)}
              role="alert"
              class="text-xs text-destructive"
              data-testid="s3-{field.slug}-error"
            >
              {vault.t(error.errorKey)}
            </p>
          {/if}
        </div>
      {/each}
    </div>
  </fieldset>

  {#if alert.kind === S3ConnectionAlertKind.Shown}
    <p
      id={form.alertId}
      class="nk-banner nk-banner-destructive flex items-start gap-2 px-3 py-2 text-xs text-foreground"
      role="alert"
      data-testid="s3-connection-error"
      data-failure={alert.failure}
    >
      <TriangleAlert
        class="mt-0.5 size-3.5 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1 text-pretty">{alert.message}</span>
    </p>
  {/if}

  {@render beforeConnect?.()}

  <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
    <Button
      type="submit"
      class="h-11 w-full sm:h-10 sm:w-auto sm:min-w-[180px]"
      data-testid={action.testId}
      disabled={pending ||
        availability === S3ConnectAvailability.AwaitingRecoveryAnswer}
    >
      {#if progress === S3ConnectionProgress.LoadingEngine}
        <RefreshCw class="size-4 animate-spin motion-reduce:animate-none" />
        {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
      {:else if progress === S3ConnectionProgress.Connecting}
        <RefreshCw class="size-4 animate-spin motion-reduce:animate-none" />
        {vault.t(action.pending)}
      {:else}
        {#if submit === S3ConnectionSubmit.ConnectAndSync}
          <ShieldCheck class="size-4" />
        {/if}
        {vault.t(action.label)}
      {/if}
    </Button>
  </div>
</form>
