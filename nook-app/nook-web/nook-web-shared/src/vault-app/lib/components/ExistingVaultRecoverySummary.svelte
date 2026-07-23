<script lang="ts">
  import { KeyRound, LockKeyhole, ShieldCheck } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()
  const summary = $derived(vault.existingVaultRecoverySummary)
</script>

{#if summary}
  <section
    class="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-left"
    data-testid="existing-vault-recovery-summary"
  >
    <div class="flex items-start gap-2">
      <ShieldCheck class="mt-0.5 size-4 shrink-0 text-primary" />
      <div class="min-w-0">
        <h3 class="truncate text-sm font-semibold text-foreground">
          {summary.vaultName}
        </h3>
        <p class="truncate font-mono text-[11px] text-muted-foreground">
          {summary.storeId}
        </p>
      </div>
    </div>

    {#if summary.requiresSentinelQuorum}
      <div class="flex items-start gap-2 text-xs text-muted-foreground">
        <LockKeyhole class="mt-0.5 size-3.5 shrink-0" />
        <p>{vault.t('vault_recovery.sentinel_required')}</p>
      </div>
    {/if}

    <div class="space-y-2" data-testid="existing-vault-passkey-hints">
      <div class="flex items-start gap-2">
        <KeyRound class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div>
          <h4 class="text-xs font-medium text-foreground">
            {vault.t('vault_recovery.passkey_title')}
          </h4>
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            {vault.t('vault_recovery.passkey_description')}
          </p>
        </div>
      </div>
      {#if summary.devices.length > 0}
        <ul class="space-y-1 pl-5">
          {#each summary.devices as device (device.deviceId)}
            <li
              class="flex min-w-0 items-center justify-between gap-2 text-xs"
              data-testid="existing-vault-device-hint"
            >
              <span class="truncate text-muted-foreground">
                {device.label || vault.t('vault_recovery.unnamed_device')}
              </span>
              <code
                class="shrink-0 rounded bg-background px-1.5 py-0.5 text-[11px] text-foreground"
              >
                {vault.t('vault_recovery.device_hint', {
                  hint: device.passkeyHint,
                })}
              </code>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="pl-5 text-[11px] text-muted-foreground">
          {vault.t('vault_recovery.no_device_hints')}
        </p>
      {/if}
    </div>

    {#if !summary.requiresSentinelQuorum}
      <div
        class="border-t border-border/60 pt-2 text-xs"
        data-testid="existing-vault-password-status"
      >
        {#if summary.passwordEntries.length > 0}
          <p class="font-medium text-foreground">
            {vault.t('vault_recovery.password_available')}
          </p>
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            {vault.t('vault_recovery.password_description')}
          </p>
          <ul class="mt-1 flex flex-wrap gap-1">
            {#each summary.passwordEntries as entry (entry.id)}
              <li class="rounded bg-background px-1.5 py-0.5 text-[11px]">
                {entry.label}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-muted-foreground">
            {vault.t('vault_recovery.password_unavailable')}
          </p>
        {/if}
      </div>
    {/if}
  </section>
{/if}
