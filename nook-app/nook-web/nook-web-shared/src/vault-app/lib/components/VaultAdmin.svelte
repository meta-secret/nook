<script lang="ts">
  import {
    Check,
    CheckCircle2,
    FolderKey,
    FileUp,
    Lock,
    PencilLine,
    Plus,
    RefreshCw,
    ShieldCheck,
    X,
  } from "@lucide/svelte";
  import SettingsAccordionSection from "$lib/components/settings/SettingsAccordionSection.svelte";
  import AuthStorage from "$lib/components/AuthStorage.svelte";
  import VaultPasswordCard from "$lib/components/VaultPasswordCard.svelte";
  import BitwardenImportPanel from "$lib/components/BitwardenImportPanel.svelte";
  import OnePasswordImportPanel from "$lib/components/OnePasswordImportPanel.svelte";
  import ApplePasswordsImportPanel from "$lib/components/ApplePasswordsImportPanel.svelte";
  import ChromePasswordsImportPanel from "$lib/components/ChromePasswordsImportPanel.svelte";
  import { Button } from "$lib/components/ui/button";
  import type {
    NookLocalVaultEntry,
    NookPasswordEntrySummary,
  } from "$app-wasm";
  import type { VaultState } from "$lib/vault.svelte";
  import type { NookImportResult } from "$lib/nook";
  import type {
    OAuthFilePreset,
    StorageProvider,
    StorageProviderType,
  } from "$lib/auth-providers";

  let {
    vault,
    isVerifying,
    isInitializing,
    syncProviders,
    syncingProviderId = undefined,
    isAuthenticated,
    isSaving,
    addProviderOpen = false,
    setupType = $bindable(undefined as StorageProviderType | undefined),
    githubPat = $bindable(""),
    githubRepo = $bindable(""),
    passwordEntries,
    isPasswordBusy,
    passwordError,
    enrollmentCode,
    onReconnect,
    onSyncProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onRemoveProvider,
    onAddPassword,
    onUpdatePassword,
    onRemovePassword,
    onIssueCode,
    onClearCode,
    onImportBitwarden,
    onImportOnePassword,
    onImportApplePasswords,
    onImportChromePasswords,
    activeSection = $bindable(
      undefined as
        | "vaults"
        | "storage"
        | "passwords"
        | "import-export"
        | undefined,
    ),
  }: {
    vault: VaultState;
    isVerifying: boolean;
    isInitializing: boolean;
    syncProviders: StorageProvider[];
    syncingProviderId?: string | undefined;
    isAuthenticated: boolean;
    isSaving: boolean;
    addProviderOpen?: boolean;
    setupType?: StorageProviderType | undefined;
    githubPat: string;
    githubRepo: string;
    passwordEntries: NookPasswordEntrySummary[];
    isPasswordBusy: boolean;
    passwordError: string;
    enrollmentCode: string;
    onReconnect: () => void | Promise<void>;
    onSyncProvider?: (id: string) => void | Promise<void>;
    onBeginAddProvider?: () => void;
    onCancelAddProvider?: () => void;
    onBeginSetup: (
      type: StorageProviderType,
      oauthPreset?: OAuthFilePreset,
    ) => void;
    onCancelSetup: () => void;
    onRemoveProvider?: (id: string) => void | Promise<void>;
    onAddPassword: (label: string, password: string) => void | Promise<void>;
    onUpdatePassword: (
      entryId: string,
      password: string,
    ) => void | Promise<void>;
    onRemovePassword: (entryId: string) => void | Promise<void>;
    onIssueCode: (entryId: string, password: string) => Promise<string | void>;
    onClearCode: () => void;
    onImportBitwarden: (
      json: string,
      password: string,
    ) => Promise<NookImportResult>;
    onImportOnePassword: (archive: Uint8Array) => Promise<NookImportResult>;
    onImportApplePasswords: (csv: string) => Promise<NookImportResult>;
    onImportChromePasswords: (csv: string) => Promise<NookImportResult>;
    activeSection?:
      | "vaults"
      | "storage"
      | "passwords"
      | "import-export"
      | undefined;
  } = $props();

  let newVaultName = $state("");
  let drafts = $state<Record<string, string>>({});
  let draftSeed = $state("");
  let creating = $state(false);
  let editingStoreId = $state<string | undefined>(undefined);
  let renamingStoreId = $state<string | undefined>(undefined);
  let switchingTo = $state<string | undefined>(undefined);
  let activeImportProvider = $state<string | undefined>(undefined);

  const activeStoreId = $derived(vault.activeVaultStoreId?.trim() ?? "");
  const vaults = $derived(vault.localVaults);
  const hasPasswords = $derived(passwordEntries.length > 0);
  const isBusy = $derived(
    isVerifying ||
      isInitializing ||
      vault.isVerifying ||
      creating ||
      renamingStoreId !== undefined ||
      switchingTo !== undefined,
  );

  function buildDrafts() {
    const next: Record<string, string> = {};
    for (const entry of vaults) {
      next[entry.storeId] = entry.displayLabel(
        vault.t("login.vault_picker_unnamed"),
      );
    }
    drafts = next;
  }

  $effect(() => {
    const seed = vaults
      .map((entry) => `${entry.storeId}:${entry.label ?? ""}`)
      .join("|");
    if (seed !== draftSeed) {
      draftSeed = seed;
      buildDrafts();
    }
  });

  function draftFor(entry: NookLocalVaultEntry) {
    return (
      drafts[entry.storeId] ??
      entry.displayLabel(vault.t("login.vault_picker_unnamed"))
    );
  }

  function setDraft(entry: NookLocalVaultEntry, value: string) {
    drafts = { ...drafts, [entry.storeId]: value };
  }

  function canSave(entry: NookLocalVaultEntry) {
    const draft = draftFor(entry).trim();
    return (
      !isBusy &&
      draft.length > 0 &&
      draft !== entry.displayLabel(vault.t("login.vault_picker_unnamed"))
    );
  }

  function beginRename(entry: NookLocalVaultEntry) {
    if (isBusy) return;
    setDraft(entry, entry.displayLabel(vault.t("login.vault_picker_unnamed")));
    editingStoreId = entry.storeId;
  }

  function cancelRename(entry: NookLocalVaultEntry) {
    setDraft(entry, entry.displayLabel(vault.t("login.vault_picker_unnamed")));
    if (editingStoreId === entry.storeId) {
      editingStoreId = undefined;
    }
  }

  async function createVault() {
    const label = newVaultName.trim();
    if (!label || isBusy) return;
    creating = true;
    try {
      await vault.createLocalVaultWithDeviceKeys(label);
      if (!vault.errorMsg) {
        newVaultName = "";
      }
    } finally {
      creating = false;
    }
  }

  async function renameVault(entry: NookLocalVaultEntry) {
    if (!canSave(entry)) return;
    renamingStoreId = entry.storeId;
    try {
      await vault.renameLocalVault(entry.storeId, draftFor(entry));
      if (!vault.errorMsg) {
        editingStoreId = undefined;
      }
    } finally {
      renamingStoreId = undefined;
    }
  }

  async function switchTo(entry: NookLocalVaultEntry) {
    if (entry.storeId === activeStoreId || isBusy) return;
    switchingTo = entry.storeId;
    try {
      await vault.switchToVault(entry.storeId);
    } finally {
      switchingTo = undefined;
    }
  }
</script>

<div class="space-y-2" data-testid="vault-admin-panel">
  <SettingsAccordionSection
    title={vault.t("vault.admin_vaults_title")}
    subtitle={vault.t("vault.admin_vaults_desc")}
    section="vaults"
    bind:activeSection
    testId="vault-admin-vaults-section"
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        data-testid="vault-admin-vault-count"
      >
        <CheckCircle2 class="size-3" />
        {vault.t("vault.admin_vault_count", { count: String(vaults.length) })}
      </span>
    {/snippet}

    <div class="space-y-4" data-testid="vault-admin-vaults-panel">
      <div
        class="flex flex-col gap-3 rounded-lg border border-dashed border-border/50 bg-muted/10 p-3 sm:flex-row sm:items-end"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <label
            for="vault-admin-create-input"
            class="text-xs font-medium text-muted-foreground"
          >
            {vault.t("vault.admin_new_vault_label")}
          </label>
          <input
            id="vault-admin-create-input"
            class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
            placeholder={vault.t("login.vault_name_placeholder")}
            data-testid="vault-admin-create-input"
            value={newVaultName}
            disabled={isBusy}
            oninput={(event) => {
              newVaultName = (event.currentTarget as HTMLInputElement).value;
            }}
            onkeydown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createVault();
              }
            }}
          />
        </div>
        <Button
          type="button"
          class="sm:min-w-[11rem]"
          data-testid="vault-admin-create-btn"
          disabled={isBusy || newVaultName.trim().length === 0}
          onclick={() => void createVault()}
        >
          {#if creating}
            <RefreshCw class="size-4 animate-spin" />
          {:else}
            <Plus class="size-4" />
          {/if}
          {vault.t("vault.switcher_create_new")}
        </Button>
      </div>

      <ul
        class="overflow-hidden rounded-lg border border-border/60 bg-background/35"
      >
        {#each vaults as entry (entry.storeId)}
          {@const isActive = entry.storeId === activeStoreId}
          {@const isEditing = editingStoreId === entry.storeId}
          <li
            class="grid gap-3 border-b border-border/60 p-3 last:border-b-0 md:grid-cols-[2.5rem_minmax(0,1fr)_auto] md:items-start"
            data-testid="vault-admin-entry"
            data-store-id={entry.storeId}
          >
            <div
              class="flex size-10 items-center justify-center rounded-md border border-border/50 bg-muted/20 text-muted-foreground md:mt-0.5"
              aria-hidden="true"
            >
              <FolderKey
                class="size-4 {isActive
                  ? 'text-primary'
                  : 'text-muted-foreground'}"
              />
            </div>

            <div class="min-w-0 space-y-2">
              {#if isEditing}
                <input
                  class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                  aria-label={vault.t("vault.manager_name_label")}
                  data-testid="vault-admin-name-input"
                  data-store-id={entry.storeId}
                  value={draftFor(entry)}
                  disabled={isBusy}
                  oninput={(event) =>
                    setDraft(
                      entry,
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                  onkeydown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void renameVault(entry);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRename(entry);
                    }
                  }}
                />
              {:else}
                <div
                  class="flex h-10 min-w-0 items-center"
                  data-testid="vault-admin-name"
                  data-store-id={entry.storeId}
                >
                  <span class="truncate text-sm font-medium text-foreground">
                    {entry.displayLabel(vault.t("login.vault_picker_unnamed"))}
                  </span>
                </div>
              {/if}
              <div
                class="truncate font-mono text-[10px] leading-none text-muted-foreground"
              >
                {entry.storeId}
              </div>
            </div>

            <div
              class="grid grid-cols-2 gap-2 md:w-[14.5rem] md:grid-cols-[7rem_6.5rem]"
            >
              {#if isEditing}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-10 w-full"
                  data-testid="vault-admin-cancel-rename-btn"
                  data-store-id={entry.storeId}
                  disabled={renamingStoreId === entry.storeId}
                  onclick={() => cancelRename(entry)}
                >
                  <X class="size-4" />
                  {vault.t("common.cancel")}
                </Button>
              {:else if !isActive}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-10 w-full"
                  data-testid="vault-admin-switch-btn"
                  data-store-id={entry.storeId}
                  disabled={isBusy}
                  onclick={() => void switchTo(entry)}
                >
                  {#if switchingTo === entry.storeId}
                    <RefreshCw class="size-4 animate-spin" />
                  {/if}
                  {vault.t("common.switch")}
                </Button>
              {:else}
                <span
                  class="inline-flex h-10 w-full items-center justify-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-3 text-sm font-medium text-primary"
                  data-testid="vault-admin-active-badge"
                >
                  <Check class="size-4" />
                  {vault.t("vault.switcher_open_badge")}
                </span>
              {/if}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                class="h-10 w-full"
                data-testid="vault-admin-rename-btn"
                data-store-id={entry.storeId}
                disabled={isEditing ? !canSave(entry) : isBusy}
                onclick={() =>
                  isEditing ? void renameVault(entry) : beginRename(entry)}
              >
                {#if isEditing && renamingStoreId === entry.storeId}
                  <RefreshCw class="size-4 animate-spin" />
                {:else if !isEditing}
                  <PencilLine class="size-4" />
                {/if}
                {vault.t("common.rename")}
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  </SettingsAccordionSection>

  <SettingsAccordionSection
    title={vault.t("settings.storage")}
    subtitle={vault.t("settings.storage_desc")}
    section="storage"
    bind:activeSection
    testId="storage-providers-section"
  >
    {#snippet badge()}
      {#if isAuthenticated}
        <span
          class="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500"
          data-testid="connected-badge"
        >
          <CheckCircle2 class="size-3" />
          {vault.t("settings.vault_unlocked")}
        </span>
      {/if}
    {/snippet}
    <AuthStorage
      {vault}
      embedded
      {syncProviders}
      {syncingProviderId}
      {isVerifying}
      {isInitializing}
      {addProviderOpen}
      bind:setupType
      bind:githubPat
      bind:githubRepo
      {onReconnect}
      {onSyncProvider}
      {onBeginAddProvider}
      {onCancelAddProvider}
      {onBeginSetup}
      {onCancelSetup}
      {onRemoveProvider}
    />
  </SettingsAccordionSection>

  <SettingsAccordionSection
    title={vault.t("settings.passwords")}
    subtitle={vault.t("settings.passwords_desc")}
    section="passwords"
    bind:activeSection
    testId="vault-unlock-section"
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {hasPasswords
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-muted/40 text-muted-foreground'}"
        data-testid="vault-password-status"
      >
        {#if hasPasswords}
          <ShieldCheck class="size-3" />
          {passwordEntries.length === 1
            ? vault.t("settings.password_count_singular")
            : vault.t("settings.password_count_plural", {
                count: String(passwordEntries.length),
              })}
        {:else}
          <Lock class="size-3" />
          {vault.t("settings.no_passwords")}
        {/if}
      </span>
    {/snippet}
    <VaultPasswordCard
      {vault}
      embedded
      {passwordEntries}
      isBusy={isPasswordBusy}
      {passwordError}
      {enrollmentCode}
      {onAddPassword}
      {onUpdatePassword}
      {onRemovePassword}
      {onIssueCode}
      {onClearCode}
      allowIssueCode={false}
    />
  </SettingsAccordionSection>

  <SettingsAccordionSection
    title={vault.t("settings.import_export")}
    subtitle={vault.t("settings.import_export_desc")}
    section="import-export"
    bind:activeSection
    testId="vault-import-export-section"
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground"
      >
        <FileUp class="size-3" />
        {vault.t("settings.import_sources")}
      </span>
    {/snippet}
    <div class="space-y-2">
      <SettingsAccordionSection
        title={vault.t("apple_passwords_import.title")}
        subtitle={vault.t("apple_passwords_import.description")}
        section="apple-passwords"
        bind:activeSection={activeImportProvider}
        testId="apple-passwords-import-section"
      >
        <ApplePasswordsImportPanel
          {vault}
          {isSaving}
          embedded
          onImport={onImportApplePasswords}
        />
      </SettingsAccordionSection>

      <SettingsAccordionSection
        title={vault.t("chrome_passwords_import.title")}
        subtitle={vault.t("chrome_passwords_import.description")}
        section="chrome-passwords"
        bind:activeSection={activeImportProvider}
        testId="chrome-passwords-import-section"
      >
        <ChromePasswordsImportPanel
          {vault}
          {isSaving}
          embedded
          onImport={onImportChromePasswords}
        />
      </SettingsAccordionSection>

      <SettingsAccordionSection
        title={vault.t("bitwarden_import.title")}
        subtitle={vault.t("bitwarden_import.description")}
        section="bitwarden"
        bind:activeSection={activeImportProvider}
        testId="bitwarden-import-section"
      >
        <BitwardenImportPanel
          {vault}
          {isSaving}
          embedded
          onImport={onImportBitwarden}
        />
      </SettingsAccordionSection>

      <SettingsAccordionSection
        title={vault.t("onepassword_import.title")}
        subtitle={vault.t("onepassword_import.description")}
        section="onepassword"
        bind:activeSection={activeImportProvider}
        testId="onepassword-import-section"
      >
        <OnePasswordImportPanel
          {vault}
          {isSaving}
          embedded
          onImport={onImportOnePassword}
        />
      </SettingsAccordionSection>
    </div>
  </SettingsAccordionSection>
</div>
