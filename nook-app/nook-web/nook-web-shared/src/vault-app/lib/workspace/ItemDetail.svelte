<script lang="ts">
  import { Option } from "effect";
  import type { WorkspaceItem } from "./item-metadata";
  import { onDestroy } from "svelte";
  import { ArrowLeft, Eye, EyeOff, Pencil, Trash2 } from "@lucide/svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import {
    SecretType,
    type NookSecretRecord,
    type AuthenticatorCodeView,
  } from "$lib/nook";
  import { SecretExposure } from "$lib/vault/secret-exposure";
  import { VaultOperationStale } from "$lib/runtime/vault-operation-stale";
  import { SecretFailurePresentation } from "$lib/vault/secret-operation-failure";
  import { SecretEditorKind } from "$lib/components/secret-vault-state";
  import { I18N_KEYS as K } from "../../../generated/i18n-keys";
  import { itemFields } from "./item-fields";
  import ItemEditor from "./ItemEditor.svelte";
  let {
    vault,
    item,
    close,
  }: { vault: VaultState; item: WorkspaceItem; close: () => void } = $props();
  const emptyRecords: ConstructorParameters<typeof SecretExposure>[0] = {};
  const exposure = new SecretExposure(emptyRecords);
  let record = $state<Option.Option<NookSecretRecord>>(Option.none());
  let editing = $state(false);
  let deleting = $state(false);
  let busy = $state(false);
  let code = $state<Option.Option<AuthenticatorCodeView>>(Option.none());
  $effect(() => {
    if (Option.isNone(record) || item.type !== SecretType.Authenticator) return;
    let active = true;
    let reading = false;
    async function refreshCode() {
      if (reading) return;
      reading = true;
      const result = await vault.currentAuthenticatorCode(item.id);
      reading = false;
      if (!active) return;
      if (result.isOk()) code = Option.some(result.value);
      else vault.errorMsg = vault.t(result.error.translationKey);
    }
    void refreshCode();
    const timer = setInterval(() => void refreshCode(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
      code = Option.none();
    };
  });
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      vault.showSuccess(vault.t(K.CommonCopied));
    } catch {
      vault.errorMsg = vault.t(K.ErrorsVaultGeneric);
    }
  }
  function download() {
    if (Option.isNone(record) || item.type !== SecretType.FileAttachment)
      return;
    const binary = atob(record.value.contentBase64);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const options: BlobPropertyBag = {
      type: record.value.mimeType || "application/octet-stream",
    };
    const blob = new Blob([bytes], options);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = record.value.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  onDestroy(() => exposure.free());
  async function reveal() {
    busy = true;
    const request: Parameters<SecretExposure["toggle"]>[0] = {
      id: item.id,
      load: (id) => vault.decryptSecret(id),
    };
    const result = await exposure.toggle(request);
    busy = false;
    if (result.isErr()) vault.errorMsg = vault.t(result.error.translationKey);
    else if (!(result.value instanceof VaultOperationStale))
      record = Option.fromUndefinedOr(result.value[item.id]);
  }
  async function remove() {
    busy = true;
    const result = await vault.handleDeleteSecret(item.id);
    busy = false;
    if (result.isErr()) new SecretFailurePresentation(vault).show(result.error);
    else close();
  }
  function recordField(field: keyof NookSecretRecord): string {
    return Option.isSome(record) ? text(record.value[field]) : "";
  }
  function text(value: NookSecretRecord[keyof NookSecretRecord]): string {
    return Array.isArray(value)
      ? value.join("\n")
      : typeof value === "string" || typeof value === "number"
        ? String(value)
        : "";
  }
</script>

{#if editing && Option.isSome(record)}<ItemEditor
    {vault}
    editor={{ kind: SecretEditorKind.Editing, record: record.value }}
    close={() => {
      editing = false;
      close();
    }}
  />
{:else}
  <article class="detail-content">
    <div class="pane-heading">
      <button
        class="icon-button mobile-back"
        aria-label={vault.t(K.CommonBack)}
        onclick={close}><ArrowLeft size={20} /></button
      ><span class="eyebrow">{vault.t(K.WorkspaceDetail)}</span>
    </div>
    <div class="item-heading">
      <span class="item-monogram"
        >{item.displayTitle.slice(0, 1).toUpperCase()}</span
      >
      <h2>{item.displayTitle}</h2>
      <p class="muted">{item.summary}</p>
    </div>
    <div class="detail-actions">
      {#if item.type !== SecretType.Passkey}<button
          disabled={busy}
          onclick={reveal}
          >{#if Option.isSome(record)}<EyeOff size={17} />{vault.t(
              K.VaultHideValue,
            )}{:else}<Eye size={17} />{vault.t(K.VaultShowValue)}{/if}</button
        >{/if}
      {#if Option.isSome(record) && item.type !== SecretType.Passkey && item.type !== SecretType.FileAttachment}<button
          disabled={vault.editsBlocked}
          onclick={() => {
            editing = true;
          }}><Pencil size={17} />{vault.t(K.CommonEdit)}</button
        >{/if}
      <button
        class="danger-text"
        disabled={vault.editsBlocked}
        onclick={() => {
          deleting = true;
        }}><Trash2 size={17} />{vault.t(K.CommonDelete)}</button
      >
    </div>
    {#if deleting}<section class="confirmation">
        <h3>{vault.t(K.WorkspaceRemoveItem)}</h3>
        <p>{vault.t(K.WorkspaceDeleteHint)}</p>
        <div class="form-actions">
          <button
            onclick={() => {
              deleting = false;
            }}>{vault.t(K.CommonCancel)}</button
          ><button class="danger" disabled={busy} onclick={remove}
            >{vault.t(K.CommonDelete)}</button
          >
        </div>
      </section>{/if}
    {#if Option.isSome(record)}
      {#if Option.isSome(code) && item.type === SecretType.Authenticator}
        <section class="confirmation">
          <h3>{vault.t(K.VaultFieldsCurrentCode)}</h3>
          <p>{code.value.code}</p>
          <button
            onclick={() => {
              if (Option.isSome(code)) void copy(code.value.code);
            }}>{vault.t(K.VaultCopyCurrentCode)}</button
          >
        </section>
      {/if}
      <dl class="secret-fields">
        {#each itemFields(item.type) as field (field.draft)}<div>
            <dt>{vault.t(field.label)}</dt>
            <dd>{recordField(field.record) || "—"}</dd>
            {#if recordField(field.record)}<button
                class="text-button"
                onclick={() => {
                  if (Option.isSome(record))
                    void copy(recordField(field.record));
                }}>{vault.t(K.CommonCopy)}</button
              >{/if}
          </div>{/each}
      </dl>
      {#if item.type === SecretType.FileAttachment}<dl class="secret-fields">
          <div>
            <dt>{vault.t(K.VaultFieldsFileName)}</dt>
            <dd>{record.value.fileName}</dd>
          </div>
        </dl>
        <button onclick={download}>{vault.t(K.VaultDownloadFile)}</button>{/if}
    {:else if item.type === SecretType.Passkey}<p class="muted">
        {vault.t(K.VaultFieldsPasskeyManagedHint)}
      </p>
    {:else}<div class="concealed">
        <span aria-hidden="true">•••• •••• ••••</span>
        <p>{vault.t(K.VaultShowValue)}</p>
      </div>{/if}
  </article>
{/if}
