<!--
Keys of the unlocked identity: what can unlock it, read as one fact per key.
Each app that opens the identity has its own key (a passkey or a PIN on that
device); the page says how many there are, whether that is enough, and for
each key which app it unlocks, where it is kept and when it was last used.
Technical identifiers stay behind "Details".
-->
<script lang="ts">
  import { onMount } from "svelte";
  import {
    Asterisk,
    Fingerprint,
    MonitorSmartphone,
    Pencil,
    RefreshCw,
    ShieldCheck,
    TriangleAlert,
  } from "@lucide/svelte";
  import { NookIdentityLocalAccessKind } from "$app-wasm";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
  import { DashboardTextKind } from "$lib/components/devices-access-dashboard-state";
  import { IdentityDirectoryReader } from "$lib/components/devices-access/identity-directory-view";
  import { KeysLoadKind, type KeysLoad } from "./identity-keys-load";
  import {
    IdentityKeyInventory,
    IdentityKeyInventoryRowKind,
    type IdentityKeyInventoryRow,
  } from "$lib/components/devices-access/identity-key-inventory";
  import {
    PasskeyCardFactKind,
    PasskeyCardSummaryKind,
  } from "$lib/components/devices-access/passkey-card";
  import type { VaultState } from "$lib/vault.svelte";
  import { WorkspaceSection } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    onOpen,
  }: {
    vault: VaultState;
    onOpen: (section: WorkspaceSection) => void;
  } = $props();

  let load = $state<KeysLoad>({ kind: KeysLoadKind.Loading });
  let renaming = $state("");
  let draft = $state("");
  let saving = $state(false);

  async function reload(): Promise<void> {
    const manager = vault.admitManager();
    if (manager.isErr()) {
      load = { kind: KeysLoadKind.Failed };
      return;
    }
    const loaded = await new IdentityDirectoryReader(manager.value).load();
    if (loaded.isErr()) {
      load = { kind: KeysLoadKind.Failed };
      return;
    }
    const identity = loaded.value.directory.identities.find(
      (entry) =>
        entry.localAccess === NookIdentityLocalAccessKind.CurrentBrowser,
    );
    load = identity
      ? { kind: KeysLoadKind.Ready, identity, view: loaded.value.access }
      : { kind: KeysLoadKind.Failed };
  }

  onMount(() => {
    void reload();
  });

  const rows = $derived.by((): readonly IdentityKeyInventoryRow[] => {
    if (load.kind !== KeysLoadKind.Ready) return [];
    const request: ConstructorParameters<typeof IdentityKeyInventory>[0] = {
      vault,
      identity: load.identity,
      view: load.view,
    };
    return new IdentityKeyInventory(request).rows;
  });
  const keys = $derived(
    rows.filter((row) => row.kind === IdentityKeyInventoryRowKind.Protector),
  );
  const otherApps = $derived(
    rows.find((row) => row.kind === IdentityKeyInventoryRowKind.Apps)?.apps ??
      [],
  );
  const currentAppIds = $derived(
    load.kind === KeysLoadKind.Ready
      ? new Set(
          load.identity.members
            .filter((member) => member.currentBrowser)
            .map((member) => member.appId),
        )
      : new Set<string>(),
  );
  const identityLabel = $derived(
    load.kind === KeysLoadKind.Ready ? load.identity.label : "",
  );
  /** Values the inventory shows when it does not know a fact. */
  const unknownValues = $derived(
    new Set([
      vault.t(I18N_KEYS.DevicesAccessUnknown),
      vault.t(I18N_KEYS.DevicesAccessUnknownLegacy),
      vault.t(I18N_KEYS.DevicesAccessKeeperUnknown),
    ]),
  );

  function withIdentity(key: string): string {
    const request: Parameters<typeof vault.t>[0] = {
      key,
      replacements: { identity: identityLabel, count: String(keys.length) },
    };
    return vault.t(request);
  }

  type KeyFacts = {
    readonly keeper: string;
    readonly credential: string;
    readonly created: string;
  };

  /** A key's passkey facts that Nook actually knows; unknown ones are "". */
  function factsOf(row: IdentityKeyInventoryRow): KeyFacts {
    const facts =
      row.passkeySummary.kind === PasskeyCardSummaryKind.Present
        ? row.passkeySummary.summary.facts
        : [];
    const valueOf = (kind: PasskeyCardFactKind): string => {
      const found = facts.find((each) => each.kind === kind);
      return found && !unknownValues.has(found.value) ? found.value : "";
    };
    const known: KeyFacts = {
      keeper: valueOf(PasskeyCardFactKind.Keeper),
      credential: valueOf(PasskeyCardFactKind.Fingerprint),
      created: valueOf(PasskeyCardFactKind.Created),
    };
    return known;
  }

  function known(value: string): string {
    return unknownValues.has(value) ? "" : value;
  }

  function beginRename(row: IdentityKeyInventoryRow): void {
    renaming = row.key;
    draft = row.title;
  }

  async function saveRename(): Promise<void> {
    if (load.kind !== KeysLoadKind.Ready || !draft.trim()) return;
    const view = load.view;
    if (
      view.credentialId.kind !== DashboardTextKind.Known ||
      view.deviceId.kind !== DashboardTextKind.Known
    )
      return;
    const manager = vault.admitManager();
    if (manager.isErr()) {
      vault.errorMsg = vault.t(manager.error.translationKey);
      return;
    }
    saving = true;
    try {
      await manager.value.set_device_access_passkey_name(
        view.deviceId.value,
        view.credentialId.value,
        draft.trim(),
      );
      renaming = "";
      await reload();
    } catch (failure) {
      vault.errorMsg = vault.t(
        new NativeVaultStorageFailure(failure).translationKey,
      );
    } finally {
      saving = false;
    }
  }
</script>

{#if load.kind === KeysLoadKind.Loading}
  <p
    class="flex items-center gap-2 text-sm text-muted-foreground"
    role="status"
  >
    <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
    {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryLoading)}
  </p>
{:else if load.kind === KeysLoadKind.Failed}
  <p class="nk-banner px-4 py-3 text-sm text-muted-foreground" role="alert">
    {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryFailed)}
  </p>
{:else}
  <div class="grid min-w-0 gap-6" data-testid="identity-keys">
    <p class="max-w-[64ch] text-sm text-pretty text-muted-foreground">
      {withIdentity(I18N_KEYS.IdentityKeysIntro)}
    </p>

    <!-- How many keys, and whether that is enough. -->
    <section
      class="flex flex-col gap-4 border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
      data-testid="identity-keys-summary"
      data-key-count={keys.length}
    >
      <div class="flex min-w-0 items-start gap-4">
        <span
          class="font-mono text-3xl leading-none text-foreground tabular-nums"
          aria-hidden="true">{keys.length}</span
        >
        <div class="min-w-0 space-y-1">
          <p class="text-sm font-semibold text-foreground">
            {keys.length === 1
              ? vault.t(I18N_KEYS.IdentityKeysCountOne)
              : withIdentity(I18N_KEYS.IdentityKeysCountMany)}
          </p>
          <p
            class="flex items-start gap-2 text-xs text-pretty text-muted-foreground"
          >
            {#if keys.length <= 1}
              <TriangleAlert
                class="mt-0.5 size-3.5 shrink-0 text-warning"
                aria-hidden="true"
              />
              {withIdentity(I18N_KEYS.IdentityKeysSingleWarning)}
            {:else}
              <ShieldCheck
                class="mt-0.5 size-3.5 shrink-0 text-success"
                aria-hidden="true"
              />
              {withIdentity(I18N_KEYS.IdentityKeysCovered)}
            {/if}
          </p>
        </div>
      </div>
      {#if keys.length <= 1}
        <div class="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            data-testid="identity-keys-add-device"
            onclick={() => onOpen(WorkspaceSection.Devices)}
          >
            {vault.t(I18N_KEYS.IdentityOverviewAddDevice)}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="identity-keys-passwords"
            onclick={() => onOpen(WorkspaceSection.Passwords)}
          >
            {vault.t(I18N_KEYS.IdentityOverviewPasswordsLink)}
          </Button>
        </div>
      {/if}
    </section>

    <!-- One row per key. -->
    <ul class="grid gap-3" data-testid="identity-keys-list">
      {#each keys as row (row.key)}
        {@const app = row.apps[0]}
        {@const here = app ? currentAppIds.has(app.appId) : false}
        {@const facts = factsOf(row)}
        {@const keeper = facts.keeper}
        {@const lastUsed = known(row.lastUsed)}
        {@const credential = facts.credential}
        {@const created = facts.created}
        <li
          class="grid gap-3 border border-border p-4"
          data-testid="identity-key"
          data-key={row.key}
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <span class="nk-tile shrink-0" aria-hidden="true">
                {#if row.passkeySummary.kind === PasskeyCardSummaryKind.Present || row.renamable}
                  <Fingerprint class="size-4" />
                {:else}
                  <Asterisk class="size-4" />
                {/if}
              </span>
              {#if renaming === row.key}
                <form
                  class="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                  onsubmit={(event) => {
                    event.preventDefault();
                    void saveRename();
                  }}
                >
                  <input
                    class="h-9 min-w-0 flex-1 border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={vault.t(I18N_KEYS.CommonRename)}
                    bind:value={draft}
                    data-testid="identity-key-name-input"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={saving || !draft.trim()}
                    data-testid="identity-key-save"
                  >
                    {vault.t(I18N_KEYS.CommonSave)}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onclick={() => (renaming = "")}
                  >
                    {vault.t(I18N_KEYS.CommonCancel)}
                  </Button>
                </form>
              {:else}
                <span class="truncate text-base font-semibold text-foreground">
                  {row.title}
                </span>
                <span class="nk-tag shrink-0">{row.typeLabel}</span>
                {#if here}
                  <span class="nk-tag nk-tag-success shrink-0">
                    {vault.t(I18N_KEYS.IdentityOverviewThisBrowser)}
                  </span>
                {/if}
              {/if}
            </div>
            {#if row.renamable && renaming !== row.key}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="identity-key-rename"
                onclick={() => beginRename(row)}
              >
                <Pencil class="size-3.5" />
                {vault.t(I18N_KEYS.CommonRename)}
              </Button>
            {/if}
          </div>

          <dl
            class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]"
          >
            {#if app}
              <dt class="nk-label self-center">
                {vault.t(I18N_KEYS.IdentityKeysUnlocks)}
              </dt>
              <dd class="flex min-w-0 items-center gap-2 text-foreground">
                <MonitorSmartphone
                  class="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span class="truncate">{app.title}</span>
              </dd>
            {/if}
            {#if keeper}
              <dt class="nk-label self-center">
                {vault.t(I18N_KEYS.IdentityKeysKeptIn)}
              </dt>
              <dd class="truncate text-foreground">{keeper}</dd>
            {/if}
            {#if lastUsed}
              <dt class="nk-label self-center">
                {vault.t(I18N_KEYS.IdentityKeysLastUsed)}
              </dt>
              <dd class="truncate text-foreground">{lastUsed}</dd>
            {/if}
          </dl>

          {#if credential || created}
            <details class="text-xs text-muted-foreground">
              <summary class="cursor-pointer select-none">
                {vault.t(I18N_KEYS.IdentityKeysDetails)}
              </summary>
              <dl
                class="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]"
              >
                {#if credential}
                  <dt>{vault.t(I18N_KEYS.DevicesAccessCredentialId)}</dt>
                  <dd class="truncate font-mono">{credential}</dd>
                {/if}
                {#if created}
                  <dt>{vault.t(I18N_KEYS.DevicesAccessCreated)}</dt>
                  <dd>{created}</dd>
                {/if}
              </dl>
            </details>
          {/if}
        </li>
      {/each}
    </ul>

    {#if otherApps.length > 0}
      <section class="grid gap-2" data-testid="identity-keys-other">
        <h3 class="text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.IdentityKeysOtherTitle)}
        </h3>
        <p class="text-xs text-pretty text-muted-foreground">
          {withIdentity(I18N_KEYS.IdentityKeysOtherBody)}
        </p>
        <ul class="grid gap-1">
          {#each otherApps as app (app.key)}
            <li class="flex items-center gap-2 text-sm text-foreground">
              <MonitorSmartphone
                class="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              {app.title}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}
