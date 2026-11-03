<!--
The S3 setup form: endpoint, region, bucket, an optional key prefix, the
access key ID and the secret access key, then the host's one action. Rust
validates the whole form at once and names each wrong field; the form only
shows what it says. The secret is a password input with no reveal, and the
typed values live in this component until it unmounts. Inputs have no name,
so a native submission could never carry them into a URL.
-->
<script lang="ts">
  import { onMount, tick, type Component, type Snippet } from 'svelte'
  import { ExternalLink, RefreshCw, TriangleAlert } from '@lucide/svelte'
  import {
    s3_endpoint_service,
    s3_service_guides,
    validate_s3_connection_draft,
    type S3Connection,
    type S3ConnectionDraft,
    type S3DraftField,
    type S3DraftFieldError,
    type S3EndpointService,
    type S3ServiceGuide,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    idPrefix,
    framed = false,
    submitLabel,
    submitIcon: SubmitIcon,
    submitTestId,
    busy,
    busyLabel,
    submitDisabled = false,
    error,
    onConnect,
    beforeConnect,
  }: {
    vault: VaultState
    idPrefix: string
    /** First run: the form is the panel the user acts in. A wizard step
     * already is that panel. */
    framed?: boolean
    submitLabel: string
    submitIcon?: Component
    submitTestId: string
    /** An attempt or the vault engine is running: the form waits. */
    busy: boolean
    /** The submit button's words while the form waits. */
    busyLabel: string
    /** A question above the action is still unanswered. */
    submitDisabled?: boolean
    /** Why the last attempt failed, in the user's words; empty if none did. */
    error: string
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
  /** The fields Rust found wrong, each once, in form order. */
  let fieldErrors = $state.raw<readonly S3DraftFieldError[]>([])
  const noteId = $derived(`${idPrefix}-s3-secret-note`)

  /** The services Rust knows, for the Service field. */
  const guides = s3_service_guides()
  /** Any other S3-compatible server: the Service field's last choice. */
  const otherService: S3EndpointService = { kind: 'other' }
  /** The chosen service: picked in the Service field, or recognised from
   * the endpoint as it is typed. */
  let service = $state.raw<S3EndpointService>(otherService)

  /** What the form shows for the chosen service: the Service field's value,
   * the placeholders, and the key console to link (none for another
   * server). */
  type ServiceView = {
    readonly value: string
    readonly endpointPlaceholder: string
    readonly regionPlaceholder: string
    readonly keyConsoles: readonly S3ServiceGuide[]
  }
  const shown = $derived.by((): ServiceView => {
    switch (service.kind) {
      case 'known':
        return {
          value: service.guide.service,
          endpointPlaceholder: service.guide.endpointExample,
          regionPlaceholder: service.guide.regionExample,
          keyConsoles: [service.guide],
        }
      case 'other':
        return {
          value: service.kind,
          endpointPlaceholder: vault.t(
            I18N_KEYS.ProviderSetupS3EndpointPlaceholder,
          ),
          regionPlaceholder: vault.t(
            I18N_KEYS.ProviderSetupS3RegionPlaceholder,
          ),
          keyConsoles: [],
        }
    }
  })

  function pickService(value: string): void {
    const guide = guides.find((candidate) => candidate.service === value)
    service = guide ? { kind: 'known', guide } : otherService
  }

  /** A recognised endpoint selects its service; any other leaves the pick. */
  function endpointEdited(): void {
    edited('endpoint')
    const recognised = s3_endpoint_service(draft.endpoint)
    switch (recognised.kind) {
      case 'known':
        service = recognised
        return
      case 'other':
        return
    }
  }

  function inputId(field: S3DraftField): string {
    return `${idPrefix}-s3-${field}`
  }

  function errorId(field: S3DraftField): string {
    return `${inputId(field)}-error`
  }

  /** Rust's translation key for why the field is wrong; empty if it is not. */
  function errorOf(field: S3DraftField): string {
    const found = fieldErrors.find((candidate) => candidate.field === field)
    return found ? found.errorKey : ''
  }

  /** The ids describing a field: its error, and the secret's note. */
  function describedBy(field: S3DraftField): string {
    const ids = errorOf(field) ? [errorId(field)] : []
    if (field === 'secretAccessKey') ids.push(noteId)
    return ids.join(' ')
  }

  function inputClass(field: S3DraftField): string {
    const border = errorOf(field) ? 'border-destructive' : 'border-input'
    return `flex h-11 w-full rounded-none border bg-background px-3 font-mono text-sm sm:h-10 focus:outline-hidden focus:border-foreground/40 focus:ring-2 focus:ring-ring disabled:opacity-60 ${border}`
  }

  /** A corrected field stops saying it is wrong; the others keep theirs. */
  function edited(field: S3DraftField): void {
    fieldErrors = fieldErrors.filter((candidate) => candidate.field !== field)
  }

  function focus(field: S3DraftField): void {
    const input = document.getElementById(inputId(field))
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
        if (first) focus(first.field)
        return
      }
      case 'valid':
        fieldErrors = []
        await onConnect(validation.configuration)
        return
    }
  }

  onMount(() => focus('endpoint'))
</script>

{#snippet fieldError(field: S3DraftField, testId: string)}
  {#if errorOf(field)}
    <p
      id={errorId(field)}
      role="alert"
      class="text-xs text-destructive"
      data-testid={testId}
    >
      {vault.t(errorOf(field))}
    </p>
  {/if}
{/snippet}

<form novalidate class="space-y-4" aria-busy={busy} onsubmit={connect}>
  <fieldset
    class={framed
      ? 'nk-panel min-w-0 space-y-4 p-4 sm:p-5'
      : 'min-w-0 space-y-4'}
  >
    <legend class="sr-only">{vault.t(I18N_KEYS.ProviderPickerS3)}</legend>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="min-w-0 space-y-1.5 sm:col-span-2">
        <label class="nk-field-label block" for={`${idPrefix}-s3-service`}>
          {vault.t(I18N_KEYS.ProviderSetupS3ServiceLabel)}
        </label>
        <select
          id={`${idPrefix}-s3-service`}
          disabled={busy}
          data-testid="s3-service-select"
          class="flex h-11 w-full rounded-none border border-input bg-background px-3 text-sm sm:h-10 focus:outline-hidden focus:border-foreground/40 focus:ring-2 focus:ring-ring disabled:opacity-60"
          value={shown.value}
          onchange={(event) => pickService(event.currentTarget.value)}
        >
          {#each guides as guide (guide.service)}
            <option value={guide.service}>{vault.t(guide.nameKey)}</option>
          {/each}
          <option value={otherService.kind}>
            {vault.t(I18N_KEYS.ProviderSetupS3ServiceOther)}
          </option>
        </select>
      </div>

      <div class="min-w-0 space-y-1.5 sm:col-span-2">
        <label class="nk-field-label block" for={inputId('endpoint')}>
          {vault.t(I18N_KEYS.ProviderSetupS3EndpointLabel)}
        </label>
        <input
          id={inputId('endpoint')}
          type="text"
          inputmode="url"
          placeholder={shown.endpointPlaceholder}
          autocomplete="off"
          spellcheck="false"
          autocapitalize="none"
          disabled={busy}
          aria-invalid={Boolean(errorOf('endpoint'))}
          aria-describedby={describedBy('endpoint')}
          data-testid="s3-endpoint-input"
          class={inputClass('endpoint')}
          bind:value={draft.endpoint}
          oninput={endpointEdited}
        />
        {@render fieldError('endpoint', 's3-endpoint-error')}
      </div>

      <div class="min-w-0 space-y-1.5 sm:col-span-1">
        <label class="nk-field-label block" for={inputId('region')}>
          {vault.t(I18N_KEYS.ProviderSetupS3RegionLabel)}
        </label>
        <input
          id={inputId('region')}
          type="text"
          placeholder={shown.regionPlaceholder}
          autocomplete="off"
          spellcheck="false"
          autocapitalize="none"
          disabled={busy}
          aria-invalid={Boolean(errorOf('region'))}
          aria-describedby={describedBy('region')}
          data-testid="s3-region-input"
          class={inputClass('region')}
          bind:value={draft.region}
          oninput={() => edited('region')}
        />
        {@render fieldError('region', 's3-region-error')}
      </div>

      <div class="min-w-0 space-y-1.5 sm:col-span-1">
        <label class="nk-field-label block" for={inputId('bucket')}>
          {vault.t(I18N_KEYS.ProviderSetupS3BucketLabel)}
        </label>
        <input
          id={inputId('bucket')}
          type="text"
          placeholder={vault.t(I18N_KEYS.ProviderSetupS3BucketPlaceholder)}
          autocomplete="off"
          spellcheck="false"
          autocapitalize="none"
          disabled={busy}
          aria-invalid={Boolean(errorOf('bucket'))}
          aria-describedby={describedBy('bucket')}
          data-testid="s3-bucket-input"
          class={inputClass('bucket')}
          bind:value={draft.bucket}
          oninput={() => edited('bucket')}
        />
        {@render fieldError('bucket', 's3-bucket-error')}
      </div>

      <div class="min-w-0 space-y-1.5 sm:col-span-2">
        <div class="flex items-baseline justify-between gap-2">
          <label class="nk-field-label" for={inputId('keyPrefix')}>
            {vault.t(I18N_KEYS.ProviderSetupS3KeyPrefixLabel)}
          </label>
          <span class="nk-tag text-muted-foreground">
            {vault.t(I18N_KEYS.CommonOptional)}
          </span>
        </div>
        <input
          id={inputId('keyPrefix')}
          type="text"
          placeholder={vault.t(I18N_KEYS.ProviderSetupS3KeyPrefixPlaceholder)}
          autocomplete="off"
          spellcheck="false"
          autocapitalize="none"
          disabled={busy}
          aria-invalid={Boolean(errorOf('keyPrefix'))}
          aria-describedby={describedBy('keyPrefix')}
          data-testid="s3-key-prefix-input"
          class={inputClass('keyPrefix')}
          bind:value={draft.keyPrefix}
          oninput={() => edited('keyPrefix')}
        />
        {@render fieldError('keyPrefix', 's3-key-prefix-error')}
      </div>

      {#each shown.keyConsoles as guide (guide.service)}
        <div
          class="min-w-0 space-y-1 sm:col-span-2"
          data-testid="s3-create-key"
        >
          <a
            href={guide.keyConsoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 text-sm text-foreground underline underline-offset-4 hover:text-foreground/80"
            data-testid="s3-create-key-link"
          >
            {vault.t({
              key: I18N_KEYS.ProviderSetupS3CreateKey,
              replacements: { service: vault.t(guide.nameKey) },
            })}
            <ExternalLink class="size-3.5" aria-hidden="true" />
          </a>
          <p class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.ProviderSetupS3CreateKeyHint)}
          </p>
        </div>
      {/each}

      <div class="min-w-0 space-y-1.5 sm:col-span-2">
        <label class="nk-field-label block" for={inputId('accessKeyId')}>
          {vault.t(I18N_KEYS.ProviderSetupS3AccessKeyIdLabel)}
        </label>
        <input
          id={inputId('accessKeyId')}
          type="text"
          placeholder={vault.t(I18N_KEYS.ProviderSetupS3AccessKeyIdPlaceholder)}
          autocomplete="off"
          spellcheck="false"
          autocapitalize="none"
          disabled={busy}
          aria-invalid={Boolean(errorOf('accessKeyId'))}
          aria-describedby={describedBy('accessKeyId')}
          data-testid="s3-access-key-id-input"
          class={inputClass('accessKeyId')}
          bind:value={draft.accessKeyId}
          oninput={() => edited('accessKeyId')}
        />
        {@render fieldError('accessKeyId', 's3-access-key-id-error')}
      </div>

      <div class="min-w-0 space-y-1.5 sm:col-span-2">
        <label class="nk-field-label block" for={inputId('secretAccessKey')}>
          {vault.t(I18N_KEYS.ProviderSetupS3SecretAccessKeyLabel)}
        </label>
        <input
          id={inputId('secretAccessKey')}
          type="password"
          autocomplete="off"
          spellcheck="false"
          autocapitalize="none"
          disabled={busy}
          aria-invalid={Boolean(errorOf('secretAccessKey'))}
          aria-describedby={describedBy('secretAccessKey')}
          data-testid="s3-secret-access-key-input"
          class={inputClass('secretAccessKey')}
          bind:value={draft.secretAccessKey}
          oninput={() => edited('secretAccessKey')}
        />
        <p id={noteId} class="text-xs text-muted-foreground">
          {vault.t(I18N_KEYS.ProviderSetupS3SecretNote)}
        </p>
        {@render fieldError('secretAccessKey', 's3-secret-access-key-error')}
      </div>
    </div>
  </fieldset>

  {#if error}
    <p
      class="nk-banner nk-banner-destructive flex items-start gap-2 px-3 py-2 text-xs text-foreground"
      role="alert"
      data-testid="s3-connection-error"
    >
      <TriangleAlert
        class="mt-0.5 size-3.5 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1 text-pretty">{error}</span>
    </p>
  {/if}

  {@render beforeConnect?.()}

  <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
    <Button
      type="submit"
      class="h-11 w-full sm:h-10 sm:w-auto sm:min-w-[180px]"
      data-testid={submitTestId}
      disabled={busy || submitDisabled}
    >
      {#if busy}
        <RefreshCw class="size-4 animate-spin motion-reduce:animate-none" />
        {busyLabel}
      {:else}
        {#if SubmitIcon}
          <SubmitIcon class="size-4" />
        {/if}
        {submitLabel}
      {/if}
    </Button>
  </div>
</form>
