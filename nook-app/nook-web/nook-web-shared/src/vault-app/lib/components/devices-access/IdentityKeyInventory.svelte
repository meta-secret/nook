<!--
Reading this as: Operate-mode key inventory for one selected identity, with the
passkey name edited where the passkey is shown.
-->
<script lang="ts">
  import { Fingerprint, KeyRound, Pencil, Plus } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import type { DashboardView } from '../devices-access-dashboard-state'
  import type { IdentityDirectoryEntry } from './identity-directory-view'
  import {
    buildIdentityKeyInventory,
    IdentityKeyInventoryRowKind,
  } from './identity-key-inventory'

  type IdentityKeyInventoryProps = {
    vault: VaultState
    identity: IdentityDirectoryEntry
    view: DashboardView
    onRenamePasskey: (name: string) => Promise<boolean>
  }

  let { vault, identity, view, onRenamePasskey }: IdentityKeyInventoryProps =
    $props()
  let editingPasskey = $state(false)
  let passkeyDraft = $state('')
  let savingPasskey = $state(false)
  let editingIdentityId = $state('')

  $effect(() => {
    const currentIdentityId = identity.identityId
    if (editingIdentityId === currentIdentityId) return
    editingIdentityId = currentIdentityId
    editingPasskey = false
    passkeyDraft = ''
  })

  const rows = $derived.by(() => {
    const inventoryArgs: Parameters<typeof buildIdentityKeyInventory>[0] = {
      vault,
      identity,
      view,
    }
    return buildIdentityKeyInventory(inventoryArgs)
  })

  function keysHeading(): string {
    const headingArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessKeysForIdentity,
      replacements: { identity: identity.label },
    }
    return vault.t(headingArgs)
  }

  function beginPasskeyRename(name: string): void {
    passkeyDraft = name
    editingPasskey = true
  }

  async function savePasskeyRename(): Promise<void> {
    if (savingPasskey) return
    savingPasskey = true
    const saved = await onRenamePasskey(passkeyDraft)
    savingPasskey = false
    if (saved) editingPasskey = false
  }
</script>

<section class="min-w-0" data-testid="devices-access-key-inventory">
  <div>
    <p class="access-micro-label text-muted-foreground">{keysHeading()}</p>
    <div
      class="mt-4 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(7rem,0.6fr)] gap-5 border-y border-border px-3 py-3 sm:grid"
      aria-hidden="true"
    >
      <span class="access-micro-label text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessKeyColumn)}
      </span>
      <span class="access-micro-label text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessProtectorColumn)}
      </span>
      <span class="access-micro-label text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessLastUsedColumn)}
      </span>
    </div>

    <ul class="divide-y divide-border border-b border-border">
      {#each rows as row (row.key)}
        {@const Icon =
          row.kind === IdentityKeyInventoryRowKind.Protector
            ? Fingerprint
            : KeyRound}
        <li>
          <div
            class="grid min-h-20 w-full gap-3 px-3 py-4 text-left sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(7rem,0.6fr)] sm:items-center sm:gap-5"
            data-testid="devices-access-key-row"
            data-kind={row.kind}
          >
            <span class="flex min-w-0 items-center gap-3">
              <span
                class="grid size-10 shrink-0 place-items-center rounded-full border border-border text-foreground"
                aria-hidden="true"
              >
                <Icon class="size-4" />
              </span>
              <span class="min-w-0 flex-1">
                {#if row.kind === IdentityKeyInventoryRowKind.Protector && editingPasskey}
                  <span class="flex min-w-0 items-center gap-2">
                    <input
                      class="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                      bind:value={passkeyDraft}
                      disabled={savingPasskey}
                      aria-label={vault.t(
                        I18N_KEYS.DevicesAccessNookPasskeyName,
                      )}
                      data-testid="devices-access-passkey-name-input"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingPasskey}
                      onclick={() => void savePasskeyRename()}
                    >
                      {vault.t(I18N_KEYS.CommonSave)}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={savingPasskey}
                      onclick={() => (editingPasskey = false)}
                    >
                      {vault.t(I18N_KEYS.CommonCancel)}
                    </Button>
                  </span>
                {:else}
                  <span class="flex min-w-0 items-center gap-2">
                    <span
                      class="block min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
                    >
                      {row.title}
                    </span>
                    {#if row.kind === IdentityKeyInventoryRowKind.Protector && row.renamable}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onclick={() => beginPasskeyRename(row.title)}
                        data-testid="devices-access-rename-passkey"
                      >
                        <Pencil class="size-3.5" />
                        {vault.t(I18N_KEYS.CommonRename)}
                      </Button>
                    {/if}
                  </span>
                {/if}
                <span
                  class="mt-0.5 block text-xs text-muted-foreground sm:hidden"
                >
                  {row.typeLabel}
                </span>
              </span>
            </span>
            <span class="min-w-0">
              <span class="access-micro-label text-muted-foreground sm:hidden">
                {vault.t(I18N_KEYS.DevicesAccessProtectorColumn)}
              </span>
              <span class="mt-1 block truncate text-sm text-foreground sm:mt-0">
                {row.protector}
              </span>
            </span>
            <span class="min-w-0">
              <span class="access-micro-label text-muted-foreground sm:hidden">
                {vault.t(I18N_KEYS.DevicesAccessLastUsedColumn)}
              </span>
              <span class="mt-1 block text-sm text-foreground sm:mt-0">
                {row.lastUsed}
              </span>
            </span>
          </div>
        </li>
      {/each}
    </ul>

    <div class="mt-4">
      <Button type="button" variant="ghost" disabled>
        <Plus class="size-4" />
        {vault.t(I18N_KEYS.DevicesAccessAddKey)}
      </Button>
      <p
        class="mt-1 max-w-[60ch] text-xs leading-relaxed text-muted-foreground"
      >
        {vault.t(I18N_KEYS.DevicesAccessAddKeyUnavailable)}
      </p>
    </div>
  </div>
</section>
