<!--
The keys of an S3 provider on the Sync page: each access key ID, the one this
device signs with tagged in use, and a remove control on each spare. Add key
opens a small form: the key ID and its secret, a password input with no
reveal and no name, with the service's key console when Rust recognises the
endpoint. Rust validates the key and keeps it on the row as a spare; the row
is saved sealed like every provider row.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { ExternalLink, KeyRound, Plus, RefreshCw, X } from '@lucide/svelte'
  import {
    add_s3_spare_key,
    remove_s3_spare_key,
    s3_endpoint_service,
    type S3Connection,
    type S3DraftField,
    type S3DraftFieldError,
    type S3KeyDraft,
    type S3SpareKeyRemoval,
    type S3SpareKeyRequest,
    type S3ServiceGuide,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { StorageProvider } from '$lib/auth/providers'
  import type { VaultState } from '$lib/vault.svelte'
  import { ProviderRowUpdate } from '$lib/vault/provider-row-update'
  import {
    S3KeyFormRequests,
    type S3KeyFormMatch,
  } from '$lib/vault/s3-key-form-request'

  let {
    vault,
    provider,
    connection,
    disabled,
  }: {
    vault: VaultState
    /** The saved S3 row. */
    provider: StorageProvider
    /** Its S3 connection. */
    connection: S3Connection
    disabled: boolean
  } = $props()

  const idPrefix = $derived(`s3-keys-${provider.id}`)
  /** The invite page's ask for this provider's form. */
  function askedForForm(): boolean {
    const match: S3KeyFormMatch = {
      request: vault.s3KeyFormRequest,
      providerId: provider.id,
    }
    return S3KeyFormRequests.opens(match)
  }
  let formOpen = $state(untrack(() => askedForForm()))
  let draft = $state<S3KeyDraft>({ accessKeyId: '', secretAccessKey: '' })
  let fieldErrors = $state.raw<readonly S3DraftFieldError[]>([])
  let error = $state('')
  let saving = $state(false)
  const busy = $derived(disabled || saving)

  // The invite page asked for this form: it opens once, then the ask is spent.
  onMount(() => {
    if (askedForForm()) vault.s3KeyFormRequest = S3KeyFormRequests.CLOSED
  })

  /** The service's key console, for a recognised endpoint only. */
  const keyConsoles = $derived.by((): readonly S3ServiceGuide[] => {
    const service = s3_endpoint_service(connection.endpoint)
    switch (service.kind) {
      case 'known':
        return [service.guide]
      case 'other':
        return []
    }
  })

  function createKeyText(guide: S3ServiceGuide): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderSetupS3CreateKey,
      replacements: { service: vault.t(guide.nameKey) },
    }
    return vault.t(request)
  }

  function removeLabel(accessKeyId: string): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.AuthStorageS3RemoveKey,
      replacements: { id: accessKeyId },
    }
    return vault.t(request)
  }

  function errorOf(field: S3DraftField): string {
    const found = fieldErrors.find((candidate) => candidate.field === field)
    return found ? found.errorKey : ''
  }

  function inputClass(field: S3DraftField): string {
    const border = errorOf(field) ? 'border-destructive' : 'border-input'
    return `flex h-11 w-full rounded-none border bg-background px-3 font-mono text-sm sm:h-10 focus:outline-hidden focus:border-foreground/40 focus:ring-2 focus:ring-ring disabled:opacity-60 ${border}`
  }

  function closeForm(): void {
    formOpen = false
    draft = { accessKeyId: '', secretAccessKey: '' }
    fieldErrors = []
    error = ''
  }

  async function saveRow(row: StorageProvider): Promise<boolean> {
    saving = true
    try {
      const saved = await new ProviderRowUpdate(vault).save(row)
      if (saved.isErr()) {
        error = vault.t(saved.error.translationKey)
        return false
      }
      return true
    } finally {
      saving = false
    }
  }

  async function addKey(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    error = ''
    const request: S3SpareKeyRequest = {
      provider: $state.snapshot(provider),
      key: $state.snapshot(draft),
    }
    let addition: ReturnType<typeof add_s3_spare_key>
    try {
      addition = add_s3_spare_key(request)
    } catch {
      error = vault.t(I18N_KEYS.ErrorsValidationS3StorageTargetInvalid)
      return
    }
    switch (addition.state) {
      case 'invalid':
        fieldErrors = addition.fields
        return
      case 'added':
        fieldErrors = []
        if (await saveRow(addition.provider)) closeForm()
        return
    }
  }

  async function removeKey(accessKeyId: string): Promise<void> {
    error = ''
    const removal: S3SpareKeyRemoval = {
      provider: $state.snapshot(provider),
      accessKeyId,
    }
    await saveRow(remove_s3_spare_key(removal))
  }
</script>

{#snippet fieldError(field: S3DraftField, testId: string)}
  {#if errorOf(field)}
    <p role="alert" class="text-xs text-destructive" data-testid={testId}>
      {vault.t(errorOf(field))}
    </p>
  {/if}
{/snippet}

<div
  class="mt-3 grid gap-2 border-t border-border pt-3"
  data-testid="s3-keys-{provider.id}"
>
  <p class="nk-label">{vault.t(I18N_KEYS.AuthStorageS3Keys)}</p>
  <ul class="grid gap-1" data-testid="s3-keys-list">
    <li class="flex items-center gap-2 text-xs" data-testid="s3-key-row">
      <KeyRound
        class="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span class="min-w-0 truncate font-mono text-foreground"
        >{connection.accessKeyId}</span
      >
      <span class="nk-tag text-muted-foreground" data-testid="s3-key-in-use">
        {vault.t(I18N_KEYS.AuthStorageS3KeyInUse)}
      </span>
    </li>
    {#each connection.spareKeys as spare (spare.accessKeyId)}
      <li class="flex items-center gap-2 text-xs" data-testid="s3-key-row">
        <KeyRound
          class="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate font-mono text-foreground"
          >{spare.accessKeyId}</span
        >
        <button
          type="button"
          class="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          aria-label={removeLabel(spare.accessKeyId)}
          title={removeLabel(spare.accessKeyId)}
          data-testid="s3-remove-key-{spare.accessKeyId}"
          disabled={busy}
          onclick={() => void removeKey(spare.accessKeyId)}
        >
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </li>
    {/each}
  </ul>

  {#if formOpen}
    <form
      novalidate
      class="grid gap-3 border border-dashed border-border p-3"
      aria-busy={busy}
      data-testid="s3-add-key-form"
      onsubmit={addKey}
    >
      {#each keyConsoles as guide (guide.service)}
        <div class="grid gap-1" data-testid="s3-add-key-console">
          <a
            href={guide.keyConsoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 text-sm text-foreground underline underline-offset-4 hover:text-foreground/80"
            data-testid="s3-add-key-console-link"
          >
            {createKeyText(guide)}
            <ExternalLink class="size-3.5" aria-hidden="true" />
          </a>
          <p class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.ProviderSetupS3CreateKeyHint)}
          </p>
        </div>
      {/each}
      <div class="grid gap-1.5">
        <label class="nk-field-label block" for={`${idPrefix}-access-key-id`}>
          {vault.t(I18N_KEYS.ProviderSetupS3AccessKeyIdLabel)}
        </label>
        <input
          id={`${idPrefix}-access-key-id`}
          type="text"
          autocomplete="off"
          spellcheck="false"
          autocapitalize="none"
          disabled={busy}
          aria-invalid={Boolean(errorOf('accessKeyId'))}
          data-testid="s3-add-key-access-key-id-input"
          class={inputClass('accessKeyId')}
          bind:value={draft.accessKeyId}
        />
        {@render fieldError('accessKeyId', 's3-add-key-access-key-id-error')}
      </div>
      <div class="grid gap-1.5">
        <label
          class="nk-field-label block"
          for={`${idPrefix}-secret-access-key`}
        >
          {vault.t(I18N_KEYS.ProviderSetupS3SecretAccessKeyLabel)}
        </label>
        <input
          id={`${idPrefix}-secret-access-key`}
          type="password"
          autocomplete="off"
          spellcheck="false"
          autocapitalize="none"
          disabled={busy}
          aria-invalid={Boolean(errorOf('secretAccessKey'))}
          data-testid="s3-add-key-secret-access-key-input"
          class={inputClass('secretAccessKey')}
          bind:value={draft.secretAccessKey}
        />
        {@render fieldError(
          'secretAccessKey',
          's3-add-key-secret-access-key-error',
        )}
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          class="h-9 px-4"
          disabled={busy}
          data-testid="s3-add-key-save"
        >
          {#if saving}
            <RefreshCw class="size-4 animate-spin" />
          {/if}
          {vault.t(I18N_KEYS.AuthStorageS3SaveKey)}
        </Button>
        <button
          type="button"
          class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
          disabled={busy}
          data-testid="s3-add-key-cancel"
          onclick={closeForm}
        >
          {vault.t(I18N_KEYS.CommonCancel)}
        </button>
      </div>
    </form>
  {:else}
    <button
      type="button"
      class="inline-flex w-fit items-center gap-1.5 border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
      disabled={busy}
      data-testid="s3-add-key-btn"
      onclick={() => (formOpen = true)}
    >
      <Plus class="size-3.5" aria-hidden="true" />
      {vault.t(I18N_KEYS.AuthStorageS3AddKey)}
    </button>
  {/if}

  {#if error}
    <p
      class="text-xs text-destructive"
      role="alert"
      data-testid="s3-keys-error"
    >
      {error}
    </p>
  {/if}
</div>
