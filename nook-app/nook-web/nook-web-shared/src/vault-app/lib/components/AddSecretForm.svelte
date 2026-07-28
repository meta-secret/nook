<script lang="ts">
  import { ArrowLeft, RefreshCw } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import {
    buildSecretYaml,
    generateSecretId,
    type NookSecretRecord,
    type VaultItemType,
  } from "$lib/nook";
  import type { VaultState } from "$lib/vault.svelte";
  import PasskeyCreationGuidance from "./add-secret/PasskeyCreationGuidance.svelte";
  import SecretFields from "./add-secret/SecretFields.svelte";
  import { SecretFormState } from "./add-secret/secret-form-state.svelte";
  import SecretTypePicker from "./add-secret/SecretTypePicker.svelte";

  let {
    vault,
    isSaving,
    onAddSecret,
    onReplaceSecret,
    onGeneratePassword,
    onCancel,
    initialItem = undefined,
    selectedType = $bindable<VaultItemType | undefined>(undefined),
  }: {
    vault: VaultState;
    isSaving: boolean;
    onAddSecret: (
      id: string,
      type: VaultItemType,
      data: string,
    ) => Promise<void>;
    onReplaceSecret?: (
      oldId: string,
      type: VaultItemType,
      data: string,
    ) => Promise<void>;
    onGeneratePassword: (
      length: number,
      lowercase: boolean,
      uppercase: boolean,
      numbers: boolean,
      symbols: boolean,
    ) => string;
    onCancel: () => void;
    initialItem?: NookSecretRecord | undefined;
    selectedType?: VaultItemType | undefined;
  } = $props();

  const state = new SecretFormState();
  const isEditMode = $derived(initialItem !== undefined);

  const typeTitle = $derived(
    isEditMode
      ? selectedType === "login"
        ? vault.t("add_secret.title_edit_login")
        : selectedType === "api-key"
          ? vault.t("add_secret.title_edit_api_key")
          : selectedType === "seed-phrase"
            ? vault.t("add_secret.title_edit_seed_phrase")
            : selectedType === "secure-note"
              ? vault.t("add_secret.title_edit_secure_note")
              : selectedType === "authenticator"
                ? vault.t("add_secret.title_edit_authenticator")
                : selectedType === "credit-card"
                  ? vault.t("add_secret.title_edit_credit_card")
                  : selectedType === "file-attachment"
                    ? vault.t("add_secret.title_edit_file_attachment")
                    : vault.t("add_secret.title_edit_item")
      : selectedType === "login"
        ? vault.t("add_secret.title_new_login")
        : selectedType === "api-key"
          ? vault.t("add_secret.title_new_api_key")
          : selectedType === "seed-phrase"
            ? vault.t("add_secret.title_new_seed_phrase")
            : selectedType === "secure-note"
              ? vault.t("add_secret.title_new_secure_note")
              : selectedType === "authenticator"
                ? vault.t("add_secret.title_new_authenticator")
                : selectedType === "credit-card"
                  ? vault.t("add_secret.title_new_credit_card")
                  : selectedType === "file-attachment"
                    ? vault.t("add_secret.title_new_file_attachment")
                    : vault.t("add_secret.title_add_item"),
  );

  $effect(() => {
    const item = initialItem;
    if (!item) return;
    selectedType = item.type as VaultItemType;
    state.load(item);
  });

  function resetForm() {
    selectedType = undefined;
    state.reset();
  }

  function handleCancel() {
    resetForm();
    onCancel();
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedType) return;
    state.submitError = "";

    if (selectedType === "secure-note" && !state.noteBody.trim()) return;
    if (selectedType === "file-attachment" && !state.fileContentBase64) return;
    if (selectedType === "seed-phrase" && !state.seedPhraseValid) return;

    let dataYaml: string;
    try {
      dataYaml = buildSecretYaml(state.toInput(selectedType, initialItem));
    } catch (error) {
      state.submitError = vault.resolveErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    if (isEditMode && initialItem && onReplaceSecret) {
      await onReplaceSecret(initialItem.id, selectedType, dataYaml);
    } else {
      await onAddSecret(generateSecretId(), selectedType, dataYaml);
    }
    resetForm();
    onCancel();
  }

  const isSecureNoteForm = $derived(selectedType === "secure-note");
  const canSubmit = $derived(state.canSubmit(selectedType, isSaving));
  const saveLabel = $derived(
    isSaving
      ? vault.t("add_secret.working")
      : isEditMode
        ? vault.t("add_secret.save_changes")
        : vault.t("common.save"),
  );
</script>

{#if selectedType === undefined && !isEditMode}
  <SecretTypePicker {vault} onSelect={(type) => (selectedType = type)} />
{:else if selectedType === "passkey" && !isEditMode}
  <PasskeyCreationGuidance
    {vault}
    onBack={() => (selectedType = undefined)}
    onDone={handleCancel}
  />
{:else if selectedType}
  <form
    onsubmit={handleSubmit}
    class={isSecureNoteForm
      ? "flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain"
      : "space-y-4"}
    data-testid={isEditMode ? "edit-secret-form" : undefined}
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
            onclick={() => (selectedType = undefined)}
          >
            <ArrowLeft class="size-3.5" />
            {vault.t("add_secret.change_type")}
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
          {vault.t("common.cancel")}
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

    <SecretFields {vault} {state} {selectedType} {onGeneratePassword} />
  </form>
{/if}
