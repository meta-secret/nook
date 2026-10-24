<script lang="ts">
  import {
    SecretFailurePresentation,
    type SecretOperationResult,
  } from "$lib/vault/secret-operation-failure";
  import type { SecretMutationOutcome } from "$lib/vault/secrets";
  type SecretCreationSubmission = {
    readonly id: string;
    readonly type: SecretType;
    readonly data: string;
  };

  type SecretReplacementSubmission = {
    readonly oldId: string;
    readonly type: SecretType;
    readonly data: string;
  };

  import { I18N_KEYS } from "../../../generated/i18n-keys";
  import { ArrowLeft, RefreshCw } from "@lucide/svelte";
  import { SecretCategory } from "$app-wasm";
  import { Button } from "$lib/components/ui/button";
  import {
    buildSecretYaml,
    generate_secret_id,
    SecretType,
    type PasswordGenerationOptions,
  } from "$lib/nook";
  import type { VaultState } from "$lib/vault.svelte";
  import {
    SecretTypeSelectionKind,
    type SecretTypeSelection,
  } from "$lib/components/secret-form-state";
  import PasskeyCreationGuidance from "./add-secret/PasskeyCreationGuidance.svelte";
  import PersonalDataFields from "./add-secret/PersonalDataFields.svelte";
  import SecretFields from "./add-secret/SecretFields.svelte";
  import { SecretFormState } from "./add-secret/secret-form-state.svelte";
  import SecretTypePicker from "./add-secret/SecretTypePicker.svelte";
  import { SecretEditorKind, type SecretEditor } from "./secret-vault-state";

  let {
    vault,
    isSaving,
    onAddSecret,
    onReplaceSecret,
    onGeneratePassword,
    onCancel,
    section = SecretCategory.Secrets,
    editor = { kind: SecretEditorKind.Creating },
    selectedTypeState = $bindable<SecretTypeSelection>({
      kind: SecretTypeSelectionKind.ChoosingType,
    }),
  }: {
    vault: VaultState;
    isSaving: boolean;
    onAddSecret: (
      args: SecretCreationSubmission,
    ) => Promise<SecretOperationResult<SecretMutationOutcome.Added>>;
    onReplaceSecret?: (
      args: SecretReplacementSubmission,
    ) => Promise<SecretOperationResult<SecretMutationOutcome.Replaced>>;
    onGeneratePassword: (options: PasswordGenerationOptions) => string;
    onCancel: () => void;
    /** The vault section whose types the picker offers. */
    section?: SecretCategory;
    editor?: SecretEditor;
    selectedTypeState?: SecretTypeSelection;
  } = $props();

  const state = new SecretFormState();
  const isEditMode = $derived(editor.kind === SecretEditorKind.Editing);

  function newTitleKey(type: SecretType): string {
    switch (type) {
      case SecretType.Login:
        return I18N_KEYS.AddSecretTitleNewLogin;
      case SecretType.ApiKey:
        return I18N_KEYS.AddSecretTitleNewApiKey;
      case SecretType.SeedPhrase:
        return I18N_KEYS.AddSecretTitleNewSeedPhrase;
      case SecretType.SecureNote:
        return I18N_KEYS.AddSecretTitleNewSecureNote;
      case SecretType.Authenticator:
        return I18N_KEYS.AddSecretTitleNewAuthenticator;
      case SecretType.CreditCard:
        return I18N_KEYS.AddSecretTitleNewCreditCard;
      case SecretType.FileAttachment:
        return I18N_KEYS.AddSecretTitleNewFileAttachment;
      case SecretType.Person:
        return I18N_KEYS.AddSecretTitleNewPerson;
      case SecretType.Address:
        return I18N_KEYS.AddSecretTitleNewAddress;
      case SecretType.IdentityDocument:
        return I18N_KEYS.AddSecretTitleNewIdentityDocument;
      case SecretType.BankAccount:
        return I18N_KEYS.AddSecretTitleNewBankAccount;
      case SecretType.Passkey:
        return I18N_KEYS.AddSecretTitleAddItem;
    }
  }

  function editTitleKey(type: SecretType): string {
    switch (type) {
      case SecretType.Login:
        return I18N_KEYS.AddSecretTitleEditLogin;
      case SecretType.ApiKey:
        return I18N_KEYS.AddSecretTitleEditApiKey;
      case SecretType.SeedPhrase:
        return I18N_KEYS.AddSecretTitleEditSeedPhrase;
      case SecretType.SecureNote:
        return I18N_KEYS.AddSecretTitleEditSecureNote;
      case SecretType.Authenticator:
        return I18N_KEYS.AddSecretTitleEditAuthenticator;
      case SecretType.CreditCard:
        return I18N_KEYS.AddSecretTitleEditCreditCard;
      case SecretType.FileAttachment:
        return I18N_KEYS.AddSecretTitleEditFileAttachment;
      case SecretType.Person:
        return I18N_KEYS.AddSecretTitleEditPerson;
      case SecretType.Address:
        return I18N_KEYS.AddSecretTitleEditAddress;
      case SecretType.IdentityDocument:
        return I18N_KEYS.AddSecretTitleEditIdentityDocument;
      case SecretType.BankAccount:
        return I18N_KEYS.AddSecretTitleEditBankAccount;
      case SecretType.Passkey:
        return I18N_KEYS.AddSecretTitleEditItem;
    }
  }

  const typeTitle = $derived.by(() => {
    switch (selectedTypeState.kind) {
      case SecretTypeSelectionKind.ChoosingType:
        return vault.t(I18N_KEYS.AddSecretTitleAddItem);
      case SecretTypeSelectionKind.EditingFields:
        switch (editor.kind) {
          case SecretEditorKind.Creating:
            return vault.t(newTitleKey(selectedTypeState.itemType));
          case SecretEditorKind.Editing:
            return vault.t(editTitleKey(selectedTypeState.itemType));
        }
    }
  });

  $effect(() => {
    if (editor.kind !== SecretEditorKind.Editing) return;
    const item = editor.record;
    selectedTypeState = {
      kind: SecretTypeSelectionKind.EditingFields,
      itemType: item.type,
    };
    state.load(item);
  });

  function resetForm() {
    selectedTypeState = { kind: SecretTypeSelectionKind.ChoosingType };
    state.reset();
  }

  function handleCancel() {
    resetForm();
    onCancel();
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (selectedTypeState.kind !== SecretTypeSelectionKind.EditingFields)
      return;
    const selectedType = selectedTypeState.itemType;
    state.submitError = "";

    if (selectedType === SecretType.SecureNote && !state.noteBody.trim())
      return;
    if (selectedType === SecretType.FileAttachment && !state.fileContentBase64)
      return;
    if (selectedType === SecretType.SeedPhrase && !state.seedPhraseValid)
      return;

    let dataYaml: string;
    try {
      const toFormFieldsArgs: Parameters<typeof state.toFormFields>[0] = {
        selectedType,
        editor,
      };
      dataYaml = buildSecretYaml(state.toFormFields(toFormFieldsArgs));
    } catch (error) {
      state.submitError = vault.resolveErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    if (
      editor.kind === SecretEditorKind.Editing &&
      isEditMode &&
      onReplaceSecret
    ) {
      const onReplaceSecretArgs: Parameters<typeof onReplaceSecret>[0] = {
        oldId: editor.record.id,
        type: selectedType,
        data: dataYaml,
      };
      const result = await onReplaceSecret(onReplaceSecretArgs);
      if (result.isErr()) {
        new SecretFailurePresentation(vault).show(result.error);
        return;
      }
    } else {
      const onAddSecretArgs: Parameters<typeof onAddSecret>[0] = {
        id: generate_secret_id(),
        type: selectedType,
        data: dataYaml,
      };
      const result = await onAddSecret(onAddSecretArgs);
      if (result.isErr()) {
        new SecretFailurePresentation(vault).show(result.error);
        return;
      }
    }
    resetForm();
    onCancel();
  }

  const isSecureNoteForm = $derived(
    selectedTypeState.kind === SecretTypeSelectionKind.EditingFields &&
      selectedTypeState.itemType === SecretType.SecureNote,
  );
  const canSubmit = $derived(
    selectedTypeState.kind === SecretTypeSelectionKind.EditingFields &&
      (() => {
        const canSubmitArgs: Parameters<typeof state.canSubmit>[0] = {
          selectedType: selectedTypeState.itemType,
          isSaving,
        };
        return state.canSubmit(canSubmitArgs);
      })(),
  );
  const saveLabel = $derived(
    isSaving
      ? vault.t(I18N_KEYS.AddSecretWorking)
      : isEditMode
        ? vault.t(I18N_KEYS.AddSecretSaveChanges)
        : vault.t(I18N_KEYS.CommonSave),
  );

  function selectSecretType(type: SecretType): void {
    selectedTypeState = {
      kind: SecretTypeSelectionKind.EditingFields,
      itemType: type,
    };
  }
</script>

{#if selectedTypeState.kind === SecretTypeSelectionKind.ChoosingType && !isEditMode}
  <SecretTypePicker {vault} {section} onSelect={selectSecretType} />
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
      ? "nk-panel flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain p-4 sm:p-5"
      : "nk-panel space-y-4 p-4 sm:p-5"}
    {...isEditMode ? { "data-testid": "edit-secret-form" } : {}}
  >
    <div
      class="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border pb-3"
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
            {vault.t(I18N_KEYS.AddSecretChangeType)}
          </button>
          <span class="text-muted-foreground/50" aria-hidden="true">·</span>
        {/if}
        <h3 class="truncate text-base font-semibold text-foreground">
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
          {vault.t(I18N_KEYS.CommonCancel)}
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

    {#if selectedTypeState.itemType === SecretType.Person || selectedTypeState.itemType === SecretType.Address || selectedTypeState.itemType === SecretType.IdentityDocument || selectedTypeState.itemType === SecretType.BankAccount}
      <PersonalDataFields
        {vault}
        state={state.personal}
        selectedType={selectedTypeState.itemType}
      />
    {:else}
      <SecretFields
        {vault}
        {state}
        selectedType={selectedTypeState.itemType}
        {onGeneratePassword}
      />
    {/if}
  </form>
{/if}
