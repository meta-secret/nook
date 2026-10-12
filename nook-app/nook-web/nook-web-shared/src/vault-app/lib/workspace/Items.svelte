<script lang="ts">
  import { untrack } from "svelte";
  import {
    Plus,
    Search,
    KeyRound,
    ArrowLeft,
    ArrowRight,
  } from "@lucide/svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
  import { workspaceItem, type WorkspaceItem } from "./item-metadata";
  import { SecretEditorKind } from "$lib/components/secret-vault-state";
  import { I18N_KEYS as K } from "../../../generated/i18n-keys";
  import ItemDetail from "./ItemDetail.svelte";
  import ItemEditor from "./ItemEditor.svelte";
  let { vault }: { vault: VaultState } = $props();
  let selected = $state<WorkspaceItem>();
  let creating = $state(false);
  let query = $state(untrack(() => vault.secretQuery));
  let loading = $state(false);
  const items = $derived(vault.secrets.map(workspaceItem));
  const vaultLabel = $derived.by(() => {
    const active = vault.activeVault;
    const local =
      active.kind === ActiveVaultKind.Open
        ? vault.localVaults.find((entry) => entry.storeId === active.storeId)
        : undefined;
    return local?.label || vault.t(K.NavVault);
  });
  async function page(offset = 0) {
    loading = true;
    selected = undefined;
    const selection: Parameters<VaultState["loadSecretPage"]>[0] = {
      query,
      requestedOffset: offset,
    };
    const result = await vault.loadSecretPage(selection);
    if (result.isErr()) vault.errorMsg = vault.t(result.error.translationKey);
    loading = false;
    selected = undefined;
  }
  function close() {
    selected = undefined;
    creating = false;
  }
</script>

<div class="items-workspace" class:has-detail={!!selected || creating}>
  <section class="item-list" aria-label={vault.t(K.WorkspaceItems)}>
    <header class="list-heading">
      <div>
        <p class="eyebrow">{vaultLabel}</p>
        <h1>
          {vault.t(K.WorkspaceItems)}<span class="count"
            >{vault.secretTotal}</span
          >
        </h1>
      </div>
      <button
        class="icon-button primary"
        aria-label={vault.t(K.VaultAddSecret)}
        disabled={vault.editsBlocked}
        onclick={() => {
          selected = undefined;
          creating = true;
        }}><Plus size={21} /></button
      >
    </header>
    <form
      class="search-field"
      onsubmit={(e) => {
        e.preventDefault();
        void page();
      }}
    >
      <Search size={18} /><input
        aria-label={vault.t(K.WorkspaceSearch)}
        placeholder={vault.t(K.WorkspaceSearch)}
        bind:value={query}
      /><button
        class="icon-button"
        aria-label={vault.t(K.WorkspaceSearch)}
        disabled={loading}><ArrowRight size={17} /></button
      >
    </form>
    <div class="item-rows" aria-busy={loading}>
      {#each items as item (item.id)}<button
          class="item-row"
          class:selected={selected?.id === item.id}
          onclick={() => {
            selected = item;
            creating = false;
          }}
          ><span class="row-monogram"
            >{item.displayTitle.slice(0, 1).toUpperCase()}</span
          ><span
            ><strong>{item.displayTitle}</strong><small>{item.summary}</small
            ></span
          ></button
        >{/each}
      {#if vault.secrets.length === 0}<div class="list-empty">
          <KeyRound size={28} />
          <p>{vault.t(K.VaultNoSecrets)}</p>
        </div>{/if}
    </div>
    <footer class="pagination">
      <button
        class="icon-button"
        aria-label={vault.t(K.VaultPreviousPage)}
        disabled={loading || vault.secretPageOffset === 0}
        onclick={() =>
          page(Math.max(0, vault.secretPageOffset - vault.secretPageSize))}
        ><ArrowLeft size={17} /></button
      ><span
        >{vault.secretPageOffset +
          (vault.secrets.length ? 1 : 0)}–{vault.secretPageOffset +
          vault.secrets.length} / {vault.secretTotal}</span
      ><button
        class="icon-button"
        aria-label={vault.t(K.VaultNextPage)}
        disabled={loading ||
          vault.secretPageOffset + vault.secrets.length >= vault.secretTotal}
        onclick={() => page(vault.secretPageOffset + vault.secretPageSize)}
        ><ArrowRight size={17} /></button
      >
    </footer>
  </section>
  <section class="detail-pane" aria-label={vault.t(K.WorkspaceDetail)}>
    {#if creating}<ItemEditor
        {vault}
        editor={{ kind: SecretEditorKind.Creating }}
        {close}
      />
    {:else if selected}{#key selected.id}<ItemDetail
          {vault}
          item={selected}
          {close}
        />{/key}
    {:else}<div class="empty-state">
        <div class="empty-symbol"><KeyRound size={34} strokeWidth={1.4} /></div>
        <h2>
          {vault.t(
            vault.secretTotal ? K.WorkspaceSelectItem : K.WorkspaceEmptyTitle,
          )}
        </h2>
        <p>
          {vault.t(
            vault.secretTotal ? K.WorkspaceSelectHint : K.WorkspaceEmptyHint,
          )}
        </p>
        {#if !vault.secretTotal}<button
            class="primary"
            disabled={vault.editsBlocked}
            onclick={() => {
              creating = true;
            }}><Plus size={18} />{vault.t(K.VaultAddSecret)}</button
          >{/if}
      </div>{/if}
  </section>
</div>
