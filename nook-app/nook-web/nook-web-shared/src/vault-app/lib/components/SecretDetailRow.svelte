<script lang="ts">
  import type { SecretOperationResult } from "$lib/vault/secret-operation-failure";
  import type { SecretMutationOutcome } from "$lib/vault/secrets";
  import type { NookSecretListItem } from "$lib/nook";
  import { VaultEditDecision } from "$app-wasm";
  import type { VaultEditRestriction, VaultState } from "$lib/vault.svelte";
  import SecretDetail from "./vault/SecretDetail.svelte";
  import {
    SecretItemView,
    type SecretItemViewSubject,
  } from "./vault/secret-item-view";
  import type { SecretFieldCopy } from "./vault/secret-detail-copies";
  import {
    AuthenticatorCodePresentationKind,
    ClipboardNoticeKind,
    SecretRevealKind,
    SecretPageInteractionKind,
    type AuthenticatorCodePresentation,
    type ClipboardNotice,
    type SecretReveal,
  } from "./secret-vault-state";

  let {
    item,
    row,
    first = false,
    expanded,
    pageInteraction,
    reveal = { kind: SecretRevealKind.Hidden },
    authenticatorCode = { kind: AuthenticatorCodePresentationKind.Hidden },
    copiedNotice = { kind: ClipboardNoticeKind.Hidden },
    onToggleExpand,
    onToggleReveal,
    onEditItem,
    onDeleteSecret,
    onCopyToClipboard,
    onCopySecret,
    vault,
    editRestriction = { decision: VaultEditDecision.Allowed },
  }: {
    item: NookSecretListItem;
    /** Grid row of this entry in the two-pane vault list. */
    row: number;
    /** First entry of the list: draws the list's top edge. */
    first?: boolean;
    expanded: boolean;
    pageInteraction: SecretPageInteractionKind;
    reveal?: SecretReveal;
    authenticatorCode?: AuthenticatorCodePresentation;
    copiedNotice?: ClipboardNotice;
    onToggleExpand: (id: string) => void;
    onToggleReveal: (id: string) => Promise<void>;
    onEditItem: (item: NookSecretListItem) => Promise<void>;
    onDeleteSecret: (
      id: string,
    ) => Promise<SecretOperationResult<SecretMutationOutcome.Deleted>>;
    onCopyToClipboard: (args: SecretFieldCopy) => Promise<void>;
    onCopySecret: (id: string) => Promise<void>;
    vault: VaultState;
    editRestriction?: VaultEditRestriction;
  } = $props();

  const view = $derived.by(() => {
    const subject: SecretItemViewSubject = { item, vault };
    return new SecretItemView(subject);
  });
  const Icon = $derived(view.icon);
</script>

<div class="contents" data-testid="vault-group-{item.typeName}">
  <div class="contents" data-testid="secret-row">
    <button
      type="button"
      class="nk-vault-item"
      style:grid-row={String(row)}
      data-edge={first ? "first" : "inner"}
      aria-expanded={expanded}
      data-testid="secret-row-toggle"
      onclick={() => onToggleExpand(item.id)}
    >
      <span class="nk-tile nk-tile-sm"><Icon class="size-4" /></span>
      <span class="min-w-0">
        <span
          class="block truncate text-[0.9375rem] font-medium text-foreground"
          data-testid="secret-row-heading">{view.title}</span
        >
        {#if view.subtitle}
          <span
            class="block truncate text-[0.8125rem] text-muted-foreground"
            data-testid="secret-row-account">{view.subtitle}</span
          >
        {:else}
          <span class="block truncate text-[0.8125rem] text-muted-foreground"
            >{vault.t(view.typeLabelKey)}</span
          >
        {/if}
      </span>
    </button>
    {#if expanded}
      <SecretDetail
        {item}
        {pageInteraction}
        {reveal}
        {authenticatorCode}
        {copiedNotice}
        {editRestriction}
        {onToggleReveal}
        {onEditItem}
        {onDeleteSecret}
        {onCopyToClipboard}
        {onCopySecret}
        {vault}
      />
    {/if}
  </div>
</div>
