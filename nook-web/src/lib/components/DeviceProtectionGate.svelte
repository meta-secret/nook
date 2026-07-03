<script lang="ts">
  import { KeyRound, ShieldCheck, TriangleAlert } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'

  let { vault }: { vault: VaultState } = $props()

  const needsSetup = $derived(
    vault.deviceProtectionStatus === 'missing' ||
      vault.deviceProtectionStatus === 'plaintext',
  )

  function recover() {
    if (!confirm(vault.t('device_protection.recovery_confirm'))) {
      return
    }
    void vault.resetDeviceProtectionForRecovery()
  }
</script>

<Card
  class="mx-auto w-full max-w-lg animate-in fade-in duration-300"
  data-testid="device-protection-gate"
>
  <CardHeader class="space-y-3 text-center">
    <div
      class="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
    >
      {#if needsSetup}
        <ShieldCheck class="size-6" />
      {:else}
        <KeyRound class="size-6" />
      {/if}
    </div>
    <CardTitle>{vault.t('device_protection.title')}</CardTitle>
    <CardDescription>
      {#if vault.deviceProtectionStatus === 'plaintext'}
        {vault.t('device_protection.migration_description')}
      {:else if vault.deviceProtectionStatus === 'passkey'}
        {vault.t('device_protection.unlock_description')}
      {:else if vault.deviceProtectionStatus === 'error'}
        {vault.t('device_protection.unavailable_description')}
      {:else}
        {vault.t('device_protection.setup_description')}
      {/if}
    </CardDescription>
  </CardHeader>

  <CardContent class="space-y-3">
    {#if needsSetup}
      <Button
        class="w-full"
        disabled={vault.isVerifying}
        data-testid="device-protection-setup-btn"
        onclick={() => vault.setupDeviceProtection()}
      >
        {vault.isVerifying
          ? vault.t('device_protection.authorizing')
          : vault.t('device_protection.setup_action')}
      </Button>
    {:else if vault.deviceProtectionStatus === 'passkey'}
      <Button
        class="w-full"
        disabled={vault.isVerifying}
        data-testid="device-protection-unlock-btn"
        onclick={() => vault.unlockDeviceProtection()}
      >
        {vault.isVerifying
          ? vault.t('device_protection.authorizing')
          : vault.t('device_protection.unlock_action')}
      </Button>

      <div class="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <div class="flex gap-2 text-xs text-muted-foreground">
          <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>{vault.t('device_protection.recovery_warning')}</p>
        </div>
        <Button
          class="mt-2 h-auto px-0 text-xs"
          variant="link"
          disabled={vault.isVerifying}
          data-testid="device-protection-recovery-btn"
          onclick={recover}
        >
          {vault.t('device_protection.recovery_action')}
        </Button>
      </div>
    {/if}

    {#if vault.errorMsg}
      <p
        class="text-center text-sm text-destructive"
        role="alert"
        data-testid="device-protection-error"
      >
        {vault.resolveErrorMessage(vault.errorMsg)}
      </p>
    {/if}
  </CardContent>
</Card>
