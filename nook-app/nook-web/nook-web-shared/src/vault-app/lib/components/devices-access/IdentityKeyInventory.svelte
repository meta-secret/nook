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
    ShieldCheck,
    TriangleAlert,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import type { DashboardView } from '../devices-access-dashboard-state'
  import type { IdentityDirectoryEntry } from './identity-directory-view'
  import {
    IdentityKeyInventory,
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
    const inventoryArgs: ConstructorParameters<typeof IdentityKeyInventory>[0] =
      {
        vault,
        identity,
        view,
      }
    return new IdentityKeyInventory(inventoryArgs).rows
  })

  function keysHeading(): string {
    const headingArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessKeysForIdentity,
      replacements: { identity: identity.label },
    }
    return vault.t(headingArgs)
  }

  const protectorCount = $derived(
    rows.filter((row) => row.kind === IdentityKeyInventoryRowKind.Protector)
      .length,
  )
  const keysBanner = $derived.by(() => {
    const bannerArgs: Parameters<typeof vault.t>[0] = {
      key:
        protectorCount === 1
          ? I18N_KEYS.DevicesAccessSingleKeyWarning
          : I18N_KEYS.DevicesAccessKeysCovered,
      replacements: {
        identity: identity.label,
        count: String(protectorCount),
      },
    }
    return vault.t(bannerArgs)
  })

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

<section class="grid min-w-0 gap-4" data-testid="devices-access-key-inventory">
  {#if protectorCount > 0}
    <div
      class="nk-banner flex items-start gap-3 px-4 py-3 text-sm text-foreground {protectorCount ===
      1
        ? 'nk-banner-warning'
        : 'nk-banner-success'}"
      data-testid="devices-access-keys-banner"
    >
      {#if protectorCount === 1}
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
      {:else}
        <ShieldCheck class="mt-0.5 size-4 shrink-0 text-success" />
      {/if}
      <p class="text-pretty">{keysBanner}</p>
    </div>
  {/if}
  <p class="nk-label">{keysHeading()}</p>
  <ul class="nk-list">
    {#each rows as row (row.key)}
      {@const Icon =
        row.kind === IdentityKeyInventoryRowKind.Protector
          ? Fingerprint
          : AppWindow}
      <li class="nk-row">
        <span class="nk-tile" aria-hidden="true"><Icon class="size-4" /></span>
        <div
          class="min-w-0"
          data-testid="devices-access-key-row"
          data-kind={row.kind}
        >
          {#if row.kind === IdentityKeyInventoryRowKind.Protector && row.renamable && editingPasskey}
            <span class="flex min-w-0 flex-wrap items-center gap-2">
              <input
                class="h-9 min-w-48 flex-1 rounded-none border border-input bg-background px-2.5 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-ring"
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
            <div class="nk-row-title">
              <span class="min-w-0 break-words">{row.title}</span>
              <span class="nk-tag">{row.typeLabel}</span>
            </div>
          {/if}
          {#if row.passkeySummary.kind === PasskeyCardSummaryKind.Present}
            <dl
              class="mt-1 grid min-w-0 gap-2"
              data-testid="devices-access-passkey-facts"
            >
              {#each row.passkeySummary.summary.facts as fact (fact.kind)}
                {#if fact.kind === PasskeyCardFactKind.Keeper}
                  <div
                    class="nk-row-sub flex flex-wrap gap-x-1.5"
                    data-kind={fact.kind}
                    data-priority="primary"
                  >
                    <dt>{fact.label}</dt>
                    <dd class="font-medium text-foreground">{fact.value}</dd>
                  </div>
                {/if}
              {/each}
              <div class="nk-spec">
                {#each row.passkeySummary.summary.facts as fact (fact.kind)}
                  {#if fact.kind === PasskeyCardFactKind.Created || fact.kind === PasskeyCardFactKind.LastUsed}
                    <div
                      class="inline-flex items-baseline"
                      data-kind={fact.kind}
                      data-priority="supporting"
                    >
                      <dt class="nk-spec-key">{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  {/if}
                {/each}
              </div>
              {#each row.passkeySummary.summary.facts as fact (fact.kind)}
                {#if fact.kind === PasskeyCardFactKind.Fingerprint}
                  <div
                    class="flex min-w-0 flex-wrap items-baseline font-mono text-xs"
                    data-kind={fact.kind}
                    data-priority="secondary"
                  >
                    <dt class="nk-spec-key">{fact.label}</dt>
                    <dd class="min-w-0 break-all text-muted-foreground">
                      {fact.value}
                    </dd>
                  </div>
                {/if}
              {/each}
            </dl>
          {:else if row.kind === IdentityKeyInventoryRowKind.Protector}
            <div class="nk-spec mt-1">
              <span class="inline-flex items-baseline"
                ><span class="nk-spec-key"
                  >{vault.t(I18N_KEYS.DevicesAccessLastUsedColumn)}</span
                >{row.lastUsed}</span
              >
            </div>
          {/if}

          <div
            class="mt-3 grid gap-1.5 border-l-2 border-border pl-3"
            role="group"
            aria-label={vault.t(I18N_KEYS.DevicesAccessAppsHeading)}
            data-testid="devices-access-apps-group"
          >
            <p class="nk-spec-key">
              {vault.t(I18N_KEYS.DevicesAccessAppsHeading)}
            </p>
            <ul class="grid gap-2">
              {#each row.apps as app (app.key)}
                <li
                  class="flex min-w-0 items-start gap-2.5"
                  data-testid="devices-access-app"
                >
                  <MonitorSmartphone
                    class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="break-words text-sm font-medium text-foreground">
                      {app.title}
                      <span class="font-normal text-muted-foreground"
                        >· {app.relationship}</span
                      >
                    </p>
                    <details class="mt-1 text-xs text-muted-foreground">
                      <summary
                        class="w-fit cursor-pointer select-none font-mono tracking-wide hover:text-foreground"
                      >
                        {vault.t(I18N_KEYS.DevicesAccessAdvancedDetails)}
                      </summary>
                      <p
                        class="mt-2 break-all border-l-2 border-border bg-muted/40 px-3 py-2"
                        data-testid="devices-access-app-id"
                      >
                        <span class="font-medium text-foreground"
                          >{vault.t(I18N_KEYS.DevicesAccessDeviceId)}:</span
                        >
                        <code class="ml-1">{app.appId}</code>
                      </p>
                    </details>
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        </div>
        <div class="nk-row-actions">
          {#if row.kind === IdentityKeyInventoryRowKind.Protector && row.renamable && !editingPasskey}
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
        </div>
      </li>
    {/each}
  </ul>
</section>
