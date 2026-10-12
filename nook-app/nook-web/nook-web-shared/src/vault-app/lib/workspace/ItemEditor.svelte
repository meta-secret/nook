<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { ArrowLeft, Check } from "@lucide/svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import { SecretType, buildSecretYaml, generate_secret_id } from "$lib/nook";
  import { SecretFormState } from "$lib/components/add-secret/secret-form-state.svelte";
  import {
    SecretEditorKind,
    type SecretEditor,
  } from "$lib/components/secret-vault-state";
  import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
  import { SecretFailurePresentation } from "$lib/vault/secret-operation-failure";
  import { I18N_KEYS as K } from "../../../generated/i18n-keys";
  import { itemFields, itemTypes } from "./item-fields";
  let {
    vault,
    editor,
    close,
  }: { vault: VaultState; editor: SecretEditor; close: () => void } = $props();
  const draft = new SecretFormState();
  let selectedType = $state(
    untrack(() =>
      editor.kind === SecretEditorKind.Editing
        ? editor.record.type
        : SecretType.Login,
    ),
  );
  let busy = $state(false);
  onMount(() => {
    if (editor.kind === SecretEditorKind.Editing) draft.load(editor.record);
  });
  async function save() {
    busy = true;
    try {
      const fields: Parameters<SecretFormState["toFormFields"]>[0] = {
        selectedType,
        editor,
      };
      const data = buildSecretYaml(draft.toFormFields(fields));
      let result: Awaited<
        ReturnType<
          VaultState["handleAddSecret"] | VaultState["handleReplaceSecret"]
        >
      >;
      if (editor.kind === SecretEditorKind.Editing) {
        const request: Parameters<VaultState["handleReplaceSecret"]>[0] = {
          oldId: editor.record.id,
          type: selectedType,
          data,
        };
        result = await vault.handleReplaceSecret(request);
      } else {
        const request: Parameters<VaultState["handleAddSecret"]>[0] = {
          id: generate_secret_id(),
          type: selectedType,
          data,
        };
        result = await vault.handleAddSecret(request);
      }
      if (result.isErr())
        new SecretFailurePresentation(vault).show(result.error);
      else close();
    } catch (failure) {
      vault.errorMsg = vault.t(
        new NativeVaultStorageFailure(failure).translationKey,
      );
    } finally {
      busy = false;
    }
  }
</script>

<form
  class="detail-content editor"
  onsubmit={(e) => {
    e.preventDefault();
    void save();
  }}
>
  <div class="pane-heading">
    <button
      type="button"
      class="icon-button"
      aria-label={vault.t(K.CommonCancel)}
      onclick={close}><ArrowLeft size={20} /></button
    >
    <h2>
      {vault.t(
        editor.kind === SecretEditorKind.Creating
          ? K.AddSecretTitleAddItem
          : K.AddSecretTitleEditItem,
      )}
    </h2>
  </div>
  <label
    >{vault.t(K.WorkspaceType)}<select
      bind:value={selectedType}
      disabled={editor.kind === SecretEditorKind.Editing}
      >{#each itemTypes as item (item.type)}<option value={item.type}
          >{vault.t(item.label)}</option
        >{/each}</select
    ></label
  >
  {#each itemFields(selectedType) as field (field.draft)}
    <label
      >{vault.t(field.label)}
      {#if field.multiline}<textarea
          rows="5"
          bind:value={draft[field.draft]}
          autocomplete="off"
          spellcheck="false"></textarea>
      {:else}<input
          type={field.secret ? "password" : "text"}
          bind:value={draft[field.draft]}
          autocomplete="off"
          spellcheck="false"
        />{/if}
    </label>
  {/each}
  <div class="form-actions">
    <button type="button" onclick={close}>{vault.t(K.CommonCancel)}</button
    ><button
      class="primary"
      disabled={busy || vault.isSaving || vault.editsBlocked}
      ><Check size={17} />{vault.t(
        busy ? K.WorkspaceBusy : K.CommonSave,
      )}</button
    >
  </div>
</form>
