<script lang="ts">
  import { ArrowLeft, RefreshCw } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { buildSecretYaml, generateSecretId, SecretType } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    SecretTypeSelectionKind,
    type SecretTypeSelection,
  } from '$lib/components/secret-form-state'
  import PasskeyCreationGuidance from './add-secret/PasskeyCreationGuidance.svelte'
  import SecretFields from './add-secret/SecretFields.svelte'
  import { SecretFormState } from './add-secret/secret-form-state.svelte'
  import SecretTypePicker from './add-secret/SecretTypePicker.svelte'
  import { SecretEditorKind, type SecretEditor } from './secret-vault-state'

  let {
    vault,
    isSaving,
    onAddSecret,
    onReplaceSecret,
    onGeneratePassword,
    onCancel,
    editor = { kind: SecretEditorKind.Creating },
    selectedTypeState = $bindable<SecretTypeSelection>({
      kind: SecretTypeSelectionKind.ChoosingType,
    }),
  }: {
    vault: VaultState
    isSaving: boolean
    onAddSecret: (id: string, type: SecretType, data: string) => Promise<void>
    onReplaceSecret?: (
      oldId: string,
      type: SecretType,
      data: string,
    ) => Promise<void>
    onGeneratePassword: (
      length: number,
      lowercase: boolean,
      uppercase: boolean,
      numbers: boolean,
      symbols: boolean,
    ) => string
    onCancel: () => void
    editor?: SecretEditor
    selectedTypeState?: SecretTypeSelection
  } = $props()

  const state = new SecretFormState()
  const isEditMode = $derived(editor.kind === SecretEditorKind.Editing)

  const typeTitle = $derived.by(() => {
    if (selectedTypeState.kind !== SecretTypeSelectionKind.EditingFields) {
      return vault.t('add_secret.title_add_item')
    }
    const selectedType = selectedTypeState.itemType
    return isEditMode
      ? selectedType === SecretType.Login
        ? vault.t('add_secret.title_edit_login')
        : selectedType === SecretType.ApiKey
          ? vault.t('add_secret.title_edit_api_key')
          : selectedType === SecretType.SeedPhrase
            ? vault.t('add_secret.title_edit_seed_phrase')
            : selectedType === SecretType.SecureNote
              ? vault.t('add_secret.title_edit_secure_note')
              : selectedType === SecretType.Authenticator
                ? vault.t('add_secret.title_edit_authenticator')
                : selectedType === SecretType.CreditCard
                  ? vault.t('add_secret.title_edit_credit_card')
                  : selectedType === SecretType.FileAttachment
                    ? vault.t('add_secret.title_edit_file_attachment')
                    : vault.t('add_secret.title_edit_item')
      : selectedType === SecretType.Login
        ? vault.t('add_secret.title_new_login')
        : selectedType === SecretType.ApiKey
          ? vault.t('add_secret.title_new_api_key')
          : selectedType === SecretType.SeedPhrase
            ? vault.t('add_secret.title_new_seed_phrase')
            : selectedType === SecretType.SecureNote
              ? vault.t('add_secret.title_new_secure_note')
              : selectedType === SecretType.Authenticator
                ? vault.t('add_secret.title_new_authenticator')
                : selectedType === SecretType.CreditCard
                  ? vault.t('add_secret.title_new_credit_card')
                  : selectedType === SecretType.FileAttachment
                    ? vault.t('add_secret.title_new_file_attachment')
                    : vault.t('add_secret.title_add_item')
  })

  $effect(() => {
    if (editor.kind !== SecretEditorKind.Editing) return
    const item = editor.record
    selectedTypeState = {
      kind: SecretTypeSelectionKind.EditingFields,
      itemType: item.type,
    }
    state.load(item)
  })

  function resetForm() {
    selectedTypeState = { kind: SecretTypeSelectionKind.ChoosingType }
    state.reset()
  }

  function handleCancel() {
    resetForm()
    onCancel()
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (selectedTypeState.kind !== SecretTypeSelectionKind.EditingFields) return
    const selectedType = selectedTypeState.itemType
    state.submitError = ''

    if (selectedType === SecretType.SecureNote && !state.noteBody.trim()) return
    if (selectedType === SecretType.FileAttachment && !state.fileContentBase64)
      return
    if (selectedType === SecretType.SeedPhrase && !state.seedPhraseValid) return

    let dataYaml: string
    try {
      dataYaml = buildSecretYaml(state.toInput(selectedType, editor))
    } catch (error) {
      state.submitError = vault.resolveErrorMessage(
        error instanceof Error ? error.message : String(error),
      )
      return
    }

    if (
      editor.kind === SecretEditorKind.Editing &&
      isEditMode &&
      onReplaceSecret
    ) {
      await onReplaceSecret(editor.record.id, selectedType, dataYaml)
    } else {
      await onAddSecret(generateSecretId(), selectedType, dataYaml)
    }
    resetForm()
    onCancel()
  }

  const isSecureNoteForm = $derived(
    selectedTypeState.kind === SecretTypeSelectionKind.EditingFields &&
      selectedTypeState.itemType === SecretType.SecureNote,
  )
  const canSubmit = $derived(
    selectedTypeState.kind === SecretTypeSelectionKind.EditingFields &&
      state.canSubmit(selectedTypeState.itemType, isSaving),
  )
  const saveLabel = $derived(
    isSaving
      ? vault.t('add_secret.working')
      : isEditMode
        ? vault.t('add_secret.save_changes')
        : vault.t('common.save'),
  )
</script>

{#if selectedTypeState.kind === SecretTypeSelectionKind.ChoosingType && !isEditMode}
  <SecretTypePicker
    {vault}
    onSelect={(type) =>
      (selectedTypeState = {
        kind: SecretTypeSelectionKind.EditingFields,
        itemType: type,
      })}
  />
{:else if selectedTypeState.kind === SecretTypeSelectionKind.EditingFields && selectedTypeState.itemType === SecretType.Passkey && !isEditMode}
  <PasskeyCreationGuidance
    {vault}
    onBack={() =>
      (selectedTypeState = { kind: SecretTypeSelectionKind.ChoosingType })}
    onDone={handleCancel}
  />
{:else if selectedTypeState.kind === SecretTypeSelectionKind.EditingFields}
  <form
    onsubmit={handleSubmit}
    class={isSecureNoteForm
      ? 'flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain'
      : 'space-y-4'}
    {...isEditMode ? { 'data-testid': 'edit-secret-form' } : {}}
  >
    <div
      class="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/40 pb-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        {#if !isEditMode}
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            data-testid="change-secret-type-btn"
            onclick={() =>
              (selectedTypeState = {
                kind: SecretTypeSelectionKind.ChoosingType,
              })}
          >
            <ArrowLeft class="size-3.5" />
            {vault.t('add_secret.change_type')}
          </button>
          <span class="text-muted-foreground/50" aria-hidden="true">·</span>
        {/if}
        <h3 class="truncate text-sm font-semibold text-foreground">
          {typeTitle}
        </h3>
      </div>
      <div
        class="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="flex-1 sm:min-w-[5rem] sm:flex-none"
          data-testid="add-secret-cancel-btn"
          onclick={handleCancel}
        >
          {vault.t('common.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          class="flex-1 sm:min-w-[5rem] sm:flex-none"
          data-testid="save-secret-btn"
        >
          {#if isSaving}
            <RefreshCw class="size-4 animate-spin" />
          {/if}
          {saveLabel}
        </Button>
      </div>
    </div>

    {#if state.submitError}
      <p
        class="text-sm text-destructive"
        role="alert"
        data-testid="secret-form-error"
      >
        {state.submitError}
      </p>
    {/if}

    <SecretFields
      {vault}
      {state}
      selectedType={selectedTypeState.itemType}
      {onGeneratePassword}
    />
  </form>
{/if}
