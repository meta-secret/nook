<!--
Top of the vault list: the Secrets / Personal data section switch, the search
field, the item count and add button, and the section's type filters.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { IdCard, Plus, Search, Vault } from '@lucide/svelte'
  import type { Component } from 'svelte'
  import {
    NookSecretTypeFilter,
    SecretCategory,
    VaultEditDecision,
  } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import type { VaultEditRestriction, VaultState } from '$lib/vault.svelte'
  import {
    VaultSections,
    type VaultSectionDefinition,
  } from '$lib/vault/secret-sections'

  let {
    vault,
    definition,
    editRestriction,
    visibleItemCount,
    searchPattern = $bindable(''),
    onSelectSection,
    onSelectTypeFilter,
    onAdd,
  }: {
    vault: VaultState
    definition: VaultSectionDefinition
    editRestriction: VaultEditRestriction
    visibleItemCount: number
    searchPattern?: string
    onSelectSection: (section: SecretCategory) => void
    onSelectTypeFilter: (filter: NookSecretTypeFilter) => void
    onAdd: () => void
  } = $props()

  const sections = $derived(
    VaultSections.order.map((section) => VaultSections.definition(section)),
  )

  function sectionIcon(section: SecretCategory): Component {
    switch (section) {
      case SecretCategory.Secrets:
        return Vault
      case SecretCategory.PersonalData:
        return IdCard
    }
  }

  const countLabel = $derived.by(() => {
    switch (vault.secretTotal) {
      case visibleItemCount: {
        const countArgs: Parameters<typeof vault.t>[0] = {
          key: definition.copy.countKey,
          replacements: { count: String(visibleItemCount) },
        }
        return vault.t(countArgs)
      }
      default: {
        const pageCountArgs: Parameters<typeof vault.t>[0] = {
          key: definition.copy.countPageKey,
          replacements: {
            count: String(visibleItemCount),
            total: String(vault.secretTotal),
          },
        }
        return vault.t(pageCountArgs)
      }
    }
  })

  const addRestrictionTitle = $derived.by(() => {
    switch (editRestriction.decision) {
      case VaultEditDecision.Allowed:
        return {}
      case VaultEditDecision.BlockedSecurityConflict:
      case VaultEditDecision.BlockedSyncConflict:
      case VaultEditDecision.BlockedByArchitecture:
        return { title: editRestriction.reason }
    }
  })
</script>

<div class="flex flex-col gap-3" data-testid="secret-search-and-filter">
  <div
    class="nk-section-tabs"
    role="tablist"
    aria-label={vault.t(I18N_KEYS.VaultSectionsLabel)}
    data-testid="vault-section-switch"
  >
    {#each sections as section (section.section)}
      {@const Icon = sectionIcon(section.section)}
      <button
        type="button"
        role="tab"
        class="nk-section-tab"
        aria-selected={section.section === definition.section}
        data-testid={`vault-section-${section.testId}`}
        onclick={() => onSelectSection(section.section)}
      >
        <Icon class="size-3.5" />
        {vault.t(section.copy.tabKey)}
      </button>
    {/each}
  </div>
  <div class="flex flex-wrap items-center gap-2.5">
    <label class="nk-search">
      <Search
        class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        bind:value={searchPattern}
        data-testid="search-secrets"
        placeholder={vault.t(definition.copy.searchKey)}
        aria-label={vault.t(definition.copy.searchKey)}
        class="flex h-10 w-full rounded-none border border-border bg-card py-2 pl-9 pr-3 text-sm focus:border-foreground/40 focus:outline-hidden focus:ring-2 focus:ring-ring"
      />
    </label>
    <div class="ml-auto flex items-center gap-3">
      <span class="nk-label" data-testid="vault-secret-count">
        {countLabel}
      </span>
      <Button
        size="sm"
        data-testid="add-secret-btn"
        disabled={editRestriction.decision !== VaultEditDecision.Allowed}
        {...addRestrictionTitle}
        onclick={onAdd}
      >
        <Plus class="size-3.5" />
        {vault.t(definition.copy.addKey)}
      </Button>
    </div>
  </div>
  <div
    class="nk-chips nk-chips-track"
    role="group"
    aria-label={vault.t(definition.copy.filterGroupKey)}
    data-testid="secret-type-filter"
  >
    <button
      type="button"
      class="nk-chip"
      aria-pressed={vault.secretTypeFilter === definition.allFilter}
      data-testid="secret-type-filter-all"
      onclick={() => onSelectTypeFilter(definition.allFilter)}
    >
      {vault.t(I18N_KEYS.VaultFilterAllTypes)}
    </button>
    {#each definition.types as entry (entry.filter)}
      <button
        type="button"
        class="nk-chip"
        aria-pressed={vault.secretTypeFilter === entry.filter}
        data-testid={`secret-type-filter-${entry.testId}`}
        onclick={() => onSelectTypeFilter(entry.filter)}
      >
        {vault.t(entry.labelKey)}
      </button>
    {/each}
  </div>
</div>
