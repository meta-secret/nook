<!--
One vault, opened beside its identity's card from the vault's row. Locked,
it shows the ways in side by side: this device's passkey or PIN, and the
vault's own passphrase. Open, it offers to go in. Below, what belongs to
this vault alone: its passphrases and imports. A locked vault unlocks on
the way to either.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    ChevronRight,
    Download,
    Fingerprint,
    FolderKey,
    FolderOpen,
    RefreshCw,
    ShieldCheck,
    UserRoundCheck,
    X,
  } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import { StatusTag, StatusTone } from "$lib/components/ui/status-tag";
  import type { VaultState } from "$lib/vault.svelte";
  import { WorkspaceSection } from "$lib/vault/state/ui.svelte";
  import {
    IdentityVaultRowState,
    type IdentityVaultRow,
  } from "./identity-card-model";

  let {
    vault,
    row,
    identityName,
    keyLabel,
    busy = false,
    passphrase,
    passphraseOffered = false,
    onOpen,
    onUseIdentity,
    onManage,
    onClose,
  }: {
    vault: VaultState;
    row: IdentityVaultRow;
    identityName: string;
    /** How this device signs in to the identity: Passkey, PIN. */
    keyLabel: string;
    busy?: boolean;
    /** The vault's passphrase unlock, once its passphrases are read. */
    passphrase?: Snippet;
    /** Unlocking with a passphrase applies here (a locked browser). */
    passphraseOffered?: boolean;
    /** Unlock with this device's key, or go into an open vault. */
    onOpen: () => void;
    /** The vault belongs to an identity not in use here. */
    onUseIdentity: () => void;
    /** One of this vault's pages; a locked vault unlocks first. */
    onManage: (section: WorkspaceSection) => void;
    onClose: () => void;
  } = $props();

  const label = $derived(
    row.label || vault.t(I18N_KEYS.WorkspaceVaultFallback),
  );
  const open = $derived(row.state === IdentityVaultRowState.Open);
  const dormant = $derived(row.state === IdentityVaultRowState.Dormant);
  const canManage = $derived(
    row.state === IdentityVaultRowState.Open ||
      row.state === IdentityVaultRowState.Available,
  );

  const dormantHint = $derived.by(() => {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.WorkspaceVaultPanelKeyDormant,
      replacements: { identity: identityName },
    };
    return vault.t(request);
  });

  type ManageItem = {
    readonly section: WorkspaceSection;
    readonly testId: string;
    readonly title: string;
    readonly hint: string;
  };
  const manageItems = $derived.by((): ManageItem[] => [
    {
      section: WorkspaceSection.Passwords,
      testId: "vault-panel-passphrases",
      title: vault.t(I18N_KEYS.WorkspaceSectionPasswords),
      hint: vault.t(I18N_KEYS.WorkspaceVaultPanelPassphrasesHint),
    },
    {
      section: WorkspaceSection.Import,
      testId: "vault-panel-import",
      title: vault.t(I18N_KEYS.WorkspaceSectionImport),
      hint: vault.t(I18N_KEYS.WorkspaceVaultPanelImportHint),
    },
  ]);
</script>

{#snippet sectionLabel(text: string)}
  <h3
    class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
  >
    {text}
  </h3>
{/snippet}

<div
  class="grid min-w-0 content-start gap-6"
  data-testid="vault-panel-beside"
  data-store-id={row.storeId}
  data-state={row.state}
>
  <header class="flex items-start justify-between gap-3">
    <span class="flex min-w-0 items-center gap-3">
      <span class="nk-vault-icon size-9" aria-hidden="true">
        {#if open}
          <FolderOpen class="size-4" />
        {:else}
          <FolderKey class="size-4" />
        {/if}
      </span>
      <span class="grid min-w-0 gap-0.5">
        <h2
          class="truncate text-lg font-semibold tracking-tight text-foreground"
        >
          {label}
        </h2>
        <span class="truncate font-mono text-[11px] text-muted-foreground">
          {row.storeId}
        </span>
      </span>
    </span>
    <span class="flex flex-none items-center gap-2">
      <StatusTag
        tone={open ? StatusTone.Success : StatusTone.Neutral}
        label={open
          ? vault.t(I18N_KEYS.WorkspaceVaultOpen)
          : vault.t(I18N_KEYS.WorkspaceStatusLocked)}
      />
      <button
        type="button"
        class="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
        title={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
        data-testid="vault-panel-close"
        onclick={onClose}
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </span>
  </header>

  {#if open}
    <Button
      type="button"
      class="justify-self-start"
      data-testid="vault-panel-open"
      disabled={busy}
      onclick={onOpen}
    >
      <FolderOpen class="size-4" />
      {vault.t(I18N_KEYS.WorkspaceVaultPanelOpen)}
    </Button>
  {:else if row.state !== IdentityVaultRowState.Unavailable}
    <section class="grid gap-3">
      {@render sectionLabel(vault.t(I18N_KEYS.WorkspaceUnlock))}
      <div
        class="grid gap-3 {passphraseOffered
          ? 'xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]'
          : ''}"
      >
        <div
          class="grid content-between gap-4 border border-border bg-background p-4"
          data-testid="vault-panel-key"
        >
          <div class="grid justify-items-start gap-3">
            <span class="flex flex-col items-center gap-2">
              <span
                class="nk-pair-node"
                data-state={dormant ? "missing" : "on"}
                aria-hidden="true"
              >
                <Fingerprint class="size-5" />
              </span>
              <span class="text-[11px] font-semibold leading-tight"
                >{keyLabel}</span
              >
            </span>
            <p class="text-sm text-pretty text-muted-foreground">
              {dormant
                ? dormantHint
                : vault.t(I18N_KEYS.WorkspaceVaultPanelKeyHint)}
            </p>
          </div>
          {#if dormant}
            <Button
              type="button"
              variant="outline"
              class="justify-self-start"
              data-testid="vault-panel-use-identity"
              disabled={busy}
              onclick={onUseIdentity}
            >
              <UserRoundCheck class="size-4" />
              {vault.t(I18N_KEYS.WorkspaceUseIdentity)}
            </Button>
          {:else}
            <Button
              type="button"
              class="justify-self-start"
              data-testid="vault-panel-unlock"
              disabled={busy}
              onclick={onOpen}
            >
              {vault.t(I18N_KEYS.WorkspaceUnlock)}
            </Button>
          {/if}
        </div>
        {#if passphraseOffered}
          <div
            class="min-w-0 border border-border bg-background p-4"
            data-testid="vault-panel-passphrase"
          >
            {#if passphrase}
              {@render passphrase()}
            {:else}
              <p
                class="flex items-center gap-2 text-xs text-muted-foreground"
                role="status"
              >
                <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
                {vault.t(I18N_KEYS.WorkspaceVaultPanelReading)}
              </p>
            {/if}
          </div>
        {/if}
      </div>
    </section>
  {/if}

  {#if canManage}
    <section class="grid gap-3">
      {@render sectionLabel(vault.t(I18N_KEYS.WorkspaceVaultPanelManage))}
      <div class="nk-identity-menu" role="menu" data-testid="vault-panel-manage">
        {#each manageItems as item (item.section)}
          <button
            type="button"
            role="menuitem"
            class="nk-identity-menu-item border border-border"
            data-testid={item.testId}
            disabled={busy}
            onclick={() => onManage(item.section)}
          >
            <span class="nk-vault-icon" aria-hidden="true">
              {#if item.section === WorkspaceSection.Passwords}
                <ShieldCheck class="size-4" />
              {:else}
                <Download class="size-4" />
              {/if}
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium text-foreground"
                >{item.title}</span
              >
              <span class="truncate text-xs text-muted-foreground"
                >{item.hint}</span
              >
            </span>
            <ChevronRight
              class="size-4 flex-none text-muted-foreground opacity-60"
              aria-hidden="true"
            />
          </button>
        {/each}
      </div>
    </section>
  {/if}
</div>
