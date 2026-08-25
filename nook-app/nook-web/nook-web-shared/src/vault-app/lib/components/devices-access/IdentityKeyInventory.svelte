<!--
Reading this as: Operate-mode access inventory for one selected identity, with
apps subordinate to their protection method and technical IDs disclosed only
on request.
-->
<script lang="ts">
  import {
    AppWindow,
    Fingerprint,
    MonitorSmartphone,
    Pencil,
    Plus,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import type { DashboardView } from '../devices-access-dashboard-state'
  import type { IdentityDirectoryEntry } from './identity-directory-view'
  import {
    buildIdentityKeyInventory,
    IdentityKeyInventoryRowKind,
  } from './identity-key-inventory'
  import { PasskeyCardFactKind, PasskeyCardSummaryKind } from './passkey-card'

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
    <ul class="mt-4 divide-y divide-border border-y border-border">
      {#each rows as row (row.key)}
        {@const Icon =
          row.kind === IdentityKeyInventoryRowKind.Protector
            ? Fingerprint
            : AppWindow}
        <li class="px-3 py-5">
          <div
            class="flex min-w-0 items-start gap-3"
            data-testid="devices-access-key-row"
            data-kind={row.kind}
          >
            <span
              class="grid size-10 shrink-0 place-items-center rounded-full border border-border text-foreground"
              aria-hidden="true"
            >
              <Icon class="size-4" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="access-micro-label text-muted-foreground">
                {row.typeLabel}
              </span>
              {#if row.kind === IdentityKeyInventoryRowKind.Protector && editingPasskey}
                <span class="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                  <input
                    class="min-w-48 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    bind:value={passkeyDraft}
                    disabled={savingPasskey}
                    aria-label={vault.t(I18N_KEYS.DevicesAccessNookPasskeyName)}
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
                <span class="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    class="min-w-0 flex-1 break-words text-base font-semibold text-foreground"
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
              {#if row.passkeySummary.kind === PasskeyCardSummaryKind.Present}
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {row.passkeySummary.summary.modeLabel}
                </p>
                <dl
                  class="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-border pt-4 lg:grid-cols-4"
                  data-testid="devices-access-passkey-facts"
                >
                  {#each row.passkeySummary.summary.facts as fact (fact.kind)}
                    <div class="min-w-0" data-kind={fact.kind}>
                      <dt class="text-xs text-muted-foreground">
                        {fact.label}
                      </dt>
                      <dd
                        class="mt-1 break-words text-sm text-foreground"
                        class:font-mono={fact.kind ===
                          PasskeyCardFactKind.Fingerprint}
                        class:break-all={fact.kind ===
                          PasskeyCardFactKind.Fingerprint}
                      >
                        {fact.value}
                      </dd>
                    </div>
                  {/each}
                </dl>
              {:else if row.kind === IdentityKeyInventoryRowKind.Protector}
                <span class="mt-1 block text-xs text-muted-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessLastUsedColumn)}: {row.lastUsed}
                </span>
              {/if}
            </span>
          </div>

          <div class="mt-5 ml-5 border-l border-border pl-7 sm:ml-8 sm:pl-9">
            <p class="access-micro-label text-muted-foreground">
              {vault.t(I18N_KEYS.DevicesAccessAppsHeading)}
            </p>
            <ul class="mt-2 divide-y divide-border/70">
              {#each row.apps as app (app.key)}
                <li class="py-3" data-testid="devices-access-app">
                  <div class="flex min-w-0 items-start gap-3">
                    <MonitorSmartphone
                      class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-medium text-foreground">
                        {app.title}
                      </p>
                      <p
                        class="mt-0.5 text-xs leading-relaxed text-muted-foreground"
                      >
                        {app.relationship}
                      </p>
                      <details class="mt-2 text-xs text-muted-foreground">
                        <summary
                          class="w-fit cursor-pointer select-none hover:text-foreground"
                        >
                          {vault.t(I18N_KEYS.DevicesAccessAdvancedDetails)}
                        </summary>
                        <p
                          class="mt-2 break-all rounded-md bg-muted/40 px-3 py-2"
                          data-testid="devices-access-app-id"
                        >
                          <span class="font-medium text-foreground"
                            >{vault.t(I18N_KEYS.DevicesAccessDeviceId)}:</span
                          >
                          <code class="ml-1">{app.appId}</code>
                        </p>
                      </details>
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
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
