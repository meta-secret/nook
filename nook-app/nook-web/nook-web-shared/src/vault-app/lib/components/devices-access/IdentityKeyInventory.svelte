<!--
Reading this as: Operate-mode access inventory for one selected identity, with
apps subordinate to their protection method and technical IDs disclosed only
on request.
-->
<script lang="ts">
  import {
    AppWindow,
    Fingerprint,
    KeyRound,
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
  <ul class="grid gap-3">
    {#each rows as row (row.key)}
      {@const Icon =
        row.kind === IdentityKeyInventoryRowKind.Protector
          ? Fingerprint
          : AppWindow}
      {@const facts =
        row.passkeySummary.kind === PasskeyCardSummaryKind.Present
          ? row.passkeySummary.summary.facts
          : []}
      <li
        class="nk-panel grid min-w-0 gap-4 p-4 sm:p-5"
        data-testid="devices-access-key-row"
        data-kind={row.kind}
      >
        <header class="flex min-w-0 flex-wrap items-start gap-3">
          <span class="nk-tile nk-tile-lg text-foreground" aria-hidden="true"
            ><Icon class="size-5" /></span
          >
          <div class="min-w-0 flex-1">
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
              <div
                class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1"
              >
                <h3
                  class="min-w-0 break-words text-lg font-semibold tracking-tight text-foreground"
                >
                  {row.title}
                </h3>
                <span class="nk-tag border border-border px-1.5 py-0.5"
                  >{row.typeLabel}</span
                >
              </div>
            {/if}
            {#if row.passkeySummary.kind === PasskeyCardSummaryKind.Absent && row.kind === IdentityKeyInventoryRowKind.Protector}
              <div class="nk-spec mt-1.5">
                <span class="inline-flex items-baseline"
                  ><span class="nk-spec-key"
                    >{vault.t(I18N_KEYS.DevicesAccessLastUsedColumn)}</span
                  >{row.lastUsed}</span
                >
              </div>
            {/if}
          </div>
          {#if row.kind === IdentityKeyInventoryRowKind.Protector && row.renamable && !editingPasskey}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onclick={() => beginPasskeyRename(row.title)}
              data-testid="devices-access-rename-passkey"
            >
              <Pencil class="size-3.5" />
              {vault.t(I18N_KEYS.CommonRename)}
            </Button>
          {/if}
        </header>

        <div
          class="grid min-w-0 gap-3"
          data-testid="devices-access-passkey-facts"
        >
          <ol class="nk-chain" aria-label={row.title}>
            {#each facts as fact (fact.kind)}
              {#if fact.kind === PasskeyCardFactKind.Keeper}
                <li
                  class="nk-chain-node"
                  data-kind={fact.kind}
                  data-priority="primary"
                >
                  <span class="nk-chain-icon" aria-hidden="true"
                    ><KeyRound class="size-4" /></span
                  >
                  <span class="min-w-0">
                    <span class="nk-chain-label">{fact.label}</span>
                    <span class="nk-chain-value">{fact.value}</span>
                  </span>
                </li>
                <li class="nk-chain-link" aria-hidden="true">
                  {vault.t(I18N_KEYS.DevicesAccessChainHolds)}
                </li>
              {/if}
            {/each}
            <li class="nk-chain-node nk-chain-node-key">
              <span class="nk-chain-icon" aria-hidden="true"
                ><Icon class="size-4" /></span
              >
              <span class="min-w-0">
                <span class="nk-chain-label">{row.typeLabel}</span>
                <span class="nk-chain-value">{row.title}</span>
                {#each facts as fact (fact.kind)}
                  {#if fact.kind === PasskeyCardFactKind.Fingerprint}
                    <span
                      class="mt-0.5 block truncate font-mono text-[0.6875rem] text-muted-foreground"
                      data-kind={fact.kind}
                      data-priority="secondary"
                      title={fact.value}
                      ><span class="sr-only"
                        >{fact.label}:
                      </span>{fact.value}</span
                    >
                  {/if}
                {/each}
              </span>
            </li>
            <li class="nk-chain-link" aria-hidden="true">
              {vault.t(I18N_KEYS.DevicesAccessChainUnlocks)}
            </li>
            <li
              class="nk-chain-group"
              role="group"
              aria-label={vault.t(I18N_KEYS.DevicesAccessAppsHeading)}
              data-testid="devices-access-apps-group"
            >
              <span class="nk-chain-label px-1"
                >{vault.t(I18N_KEYS.DevicesAccessAppsHeading)}</span
              >
              <ul class="grid gap-1.5">
                {#each row.apps as app (app.key)}
                  <li class="nk-chain-node" data-testid="devices-access-app">
                    <span class="nk-chain-icon" aria-hidden="true"
                      ><MonitorSmartphone class="size-4" /></span
                    >
                    <span class="min-w-0 flex-1">
                      <span class="nk-chain-value">{app.title}</span>
                      <span class="block text-xs text-muted-foreground"
                        >{app.relationship}</span
                      >
                      <details class="mt-1 text-xs text-muted-foreground">
                        <summary
                          class="w-fit cursor-pointer select-none font-mono tracking-wide hover:text-foreground"
                        >
                          {vault.t(I18N_KEYS.DevicesAccessAdvancedDetails)}
                        </summary>
                        <p
                          class="mt-1.5 break-all border-l-2 border-border bg-muted/40 px-2.5 py-1.5"
                          data-testid="devices-access-app-id"
                        >
                          <span class="font-medium text-foreground"
                            >{vault.t(I18N_KEYS.DevicesAccessDeviceId)}:</span
                          >
                          <code class="ml-1">{app.appId}</code>
                        </p>
                      </details>
                    </span>
                  </li>
                {/each}
              </ul>
            </li>
          </ol>

          {#if facts.some((fact) => fact.kind === PasskeyCardFactKind.Created || fact.kind === PasskeyCardFactKind.LastUsed)}
            <div class="nk-spec">
              {#each facts as fact (fact.kind)}
                {#if fact.kind === PasskeyCardFactKind.Created || fact.kind === PasskeyCardFactKind.LastUsed}
                  <span
                    class="inline-flex items-baseline"
                    data-kind={fact.kind}
                    data-priority="supporting"
                  >
                    <span class="nk-spec-key">{fact.label}</span>{fact.value}
                  </span>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</section>
