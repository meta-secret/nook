<!--
Evidence for the last link: which vaults this device key was actually verified
to open, plus the unlocked vault's own device and backup-password roster.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { CircleHelp, KeyRound, ShieldCheck, Users } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import { formatAccessDate, knownText, textValue } from './access-chain'
  import type { VaultAccessView } from './access-chain'

  let {
    vault,
    vaults,
    onManageVaultDevices,
    onManageVaultPasswords,
  }: {
    vault: VaultState
    vaults: VaultAccessView[]
    onManageVaultDevices: () => void
    onManageVaultPasswords: () => void
  } = $props()
</script>

<div class="space-y-6">
  {#if vaults.length === 0}
    <p class="text-sm leading-relaxed text-muted-foreground">
      {vault.t(I18N_KEYS.DevicesAccessNoVaultsReady)}
    </p>
  {:else}
    <ul
      class="divide-y divide-border/60 border-y border-border/60"
      data-testid="devices-access-vaults"
    >
      {#each vaults as entry (entry.storeId)}
        <li class="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-foreground">
              {entry.label}
            </p>
            <details class="mt-1 text-xs text-muted-foreground">
              <summary class="cursor-pointer select-none hover:text-foreground">
                {vault.t(I18N_KEYS.DevicesAccessVaultTechnicalDetails)}
              </summary>
              <p class="mt-1 font-mono text-[0.7rem] break-all">
                {entry.storeId}
              </p>
            </details>
          </div>
          <div class="sm:text-right">
            {#if entry.verified}
              <p
                class="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
              >
                <ShieldCheck class="size-3.5" />
                {vault.t(I18N_KEYS.DevicesAccessAccessVerified)}
              </p>
              <p class="text-xs text-muted-foreground">
                {knownText(entry.verifiedAt)
                  ? formatAccessDate(vault, textValue(entry.verifiedAt))
                  : vault.t(I18N_KEYS.DevicesAccessUnknown)}
              </p>
            {:else}
              <p
                class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"
              >
                <CircleHelp class="size-3.5" />
                {vault.t(I18N_KEYS.DevicesAccessAccessUnknown)}
              </p>
              <p class="text-xs text-muted-foreground">
                {knownText(entry.lastLocalUpdateAt)
                  ? vault.t(I18N_KEYS.DevicesAccessLastLocalUpdate, {
                      date: formatAccessDate(
                        vault,
                        textValue(entry.lastLocalUpdateAt),
                      ),
                    })
                  : vault.t(I18N_KEYS.DevicesAccessNoLocalUpdate)}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if vault.isAuthenticated}
    <section class="space-y-4" data-testid="devices-access-current-vault">
      <div>
        <h3 class="access-micro-label text-muted-foreground">
          {vault.t(I18N_KEYS.DevicesAccessInsideCurrentVault)}
        </h3>
        <p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {vault.t(I18N_KEYS.DevicesAccessInsideCurrentVaultDesc)}
        </p>
      </div>
      <div class="grid gap-5 sm:grid-cols-2">
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <Users class="size-4 text-muted-foreground" />
            <h4 class="text-sm font-medium text-foreground">
              {vault.t(I18N_KEYS.DevicesAccessEnrolledDevices)}
            </h4>
            <span class="text-xs text-muted-foreground"
              >{vault.vaultMembers.length}</span
            >
          </div>
          <ul class="space-y-1.5 text-sm text-muted-foreground">
            {#each vault.vaultMembers.slice(0, 4) as member (member.authId)}
              {@const memberLabel = member.label.trim()}
              <li class="min-w-0">
                <p class="truncate">
                  {memberLabel || vault.t(I18N_KEYS.DevicesAccessUnnamedDevice)}
                </p>
                <details
                  class="mt-0.5 text-xs"
                  data-testid="devices-access-member-details"
                >
                  <summary
                    class="cursor-pointer select-none hover:text-foreground"
                  >
                    {vault.t(I18N_KEYS.DevicesAccessDeviceTechnicalDetails)}
                  </summary>
                  <p class="mt-1 font-mono text-[0.7rem] break-all">
                    {member.deviceId}
                  </p>
                </details>
              </li>
            {/each}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onclick={onManageVaultDevices}
          >
            {vault.t(I18N_KEYS.DevicesAccessManageDevices)}
          </Button>
        </div>
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <KeyRound class="size-4 text-muted-foreground" />
            <h4 class="text-sm font-medium text-foreground">
              {vault.t(I18N_KEYS.DevicesAccessBackupPasswords)}
            </h4>
            <span class="text-xs text-muted-foreground"
              >{vault.passwordEntries.length}</span
            >
          </div>
          {#if vault.passwordEntries.length > 0}
            <ul class="space-y-1.5 text-sm text-muted-foreground">
              {#each vault.passwordEntries.slice(0, 4) as entry (entry.id)}
                <li class="truncate">{entry.label}</li>
              {/each}
            </ul>
          {:else}
            <p class="text-sm text-muted-foreground">
              {vault.t(I18N_KEYS.DevicesAccessNoBackupPasswords)}
            </p>
          {/if}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onclick={onManageVaultPasswords}
          >
            {vault.t(I18N_KEYS.DevicesAccessManageBackupPasswords)}
          </Button>
        </div>
      </div>
    </section>
  {/if}
</div>
