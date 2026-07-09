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
  let pin = $state('')
  let pinConfirm = $state('')
  let passkeyLabel = $state('')
  const deviceModes = ['standard', 'anti-hacker'] as const

  const needsSetup = $derived(
    vault.deviceProtectionStatus === 'missing' ||
      vault.deviceProtectionStatus === 'plaintext' ||
      vault.deviceProtectionStatus === 'pin-setup',
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
      {:else if vault.deviceProtectionStatus === 'pin-setup'}
        {vault.t('device_protection.pin_setup_description')}
      {:else if vault.deviceProtectionStatus === 'pin'}
        {vault.t('device_protection.pin_unlock_description')}
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
    {#if vault.deviceProtectionStatus === 'pin-setup'}
      <div class="space-y-2">
        <label class="block text-sm font-medium" for="device-protection-pin">
          {vault.t('device_protection.pin_label')}
        </label>
        <input
          id="device-protection-pin"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          type="password"
          inputmode="numeric"
          autocomplete="new-password"
          bind:value={pin}
          disabled={vault.isVerifying}
          data-testid="device-protection-pin-input"
        />
      </div>
      <div class="space-y-2">
        <label
          class="block text-sm font-medium"
          for="device-protection-pin-confirm"
        >
          {vault.t('device_protection.pin_confirm_label')}
        </label>
        <input
          id="device-protection-pin-confirm"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          type="password"
          inputmode="numeric"
          autocomplete="new-password"
          bind:value={pinConfirm}
          disabled={vault.isVerifying}
          data-testid="device-protection-pin-confirm"
        />
      </div>
      <p class="text-xs text-muted-foreground">
        {vault.t('device_protection.pin_security_note')}
      </p>
      <Button
        class="w-full"
        disabled={vault.isVerifying}
        data-testid="device-protection-pin-setup-btn"
        onclick={() => vault.setupPinDeviceProtection(pin, pinConfirm)}
      >
        {vault.isVerifying
          ? vault.t('device_protection.authorizing')
          : vault.t('device_protection.pin_setup_action')}
      </Button>
    {:else if needsSetup}
      <Button
        class="w-full"
        disabled={vault.isVerifying}
        data-testid="device-protection-existing-passkey-btn"
        onclick={() => vault.recoverDeviceProtectionWithPasskey()}
      >
        {vault.isVerifying
          ? vault.t('device_protection.authorizing')
          : vault.t('device_protection.existing_passkey_action')}
      </Button>
      <p class="text-center text-xs text-muted-foreground">
        {vault.t('device_protection.existing_passkey_hint')}
      </p>

      <div
        class="grid gap-2 pt-2"
        role="radiogroup"
        aria-label={vault.t('device_protection.mode_group_label')}
        data-testid="mode-group-device"
      >
        {#each deviceModes as mode}
          <button
            type="button"
            class={[
              'rounded-md border p-3 text-left text-sm transition-colors',
              vault.draftDeviceMode === mode
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border/60 bg-background hover:bg-muted/40',
            ]}
            aria-pressed={vault.draftDeviceMode === mode}
            data-testid={`mode-option-${mode}`}
            onclick={() => {
              vault.draftDeviceMode = mode
            }}
          >
            <span class="block font-medium">
              {vault.t(`device_protection.mode_${mode.replace('-', '_')}_title`)}
            </span>
            <span class="mt-1 block text-xs text-muted-foreground">
              {vault.t(
                `device_protection.mode_${mode.replace('-', '_')}_description`,
              )}
            </span>
          </button>
        {/each}
      </div>

      <div class="space-y-2 pt-2">
        <label class="block text-sm font-medium" for="device-protection-label">
          {vault.t('device_protection.passkey_label')}
        </label>
        <input
          id="device-protection-label"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          type="text"
          autocomplete="off"
          placeholder={vault.t('device_protection.passkey_label_placeholder')}
          bind:value={passkeyLabel}
          disabled={vault.isVerifying}
          data-testid="device-protection-label-input"
        />
      </div>
      <Button
        class="w-full"
        variant="outline"
        disabled={vault.isVerifying}
        data-testid="device-protection-setup-btn"
        onclick={() =>
          vault.setupDeviceProtection(passkeyLabel, vault.draftDeviceMode)}
      >
        {vault.isVerifying
          ? vault.t('device_protection.authorizing')
          : vault.t('device_protection.setup_action')}
      </Button>
    {:else if vault.deviceProtectionStatus === 'pin'}
      <div class="space-y-2">
        <label class="block text-sm font-medium" for="device-protection-pin">
          {vault.t('device_protection.pin_label')}
        </label>
        <input
          id="device-protection-pin"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          type="password"
          inputmode="numeric"
          autocomplete="current-password"
          bind:value={pin}
          disabled={vault.isVerifying}
          data-testid="device-protection-pin-unlock-input"
        />
      </div>
      <Button
        class="w-full"
        disabled={vault.isVerifying}
        data-testid="device-protection-pin-unlock-btn"
        onclick={() => vault.unlockPinDeviceProtection(pin)}
      >
        {vault.isVerifying
          ? vault.t('device_protection.authorizing')
          : vault.t('device_protection.pin_unlock_action')}
      </Button>

      <div class="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <div class="flex gap-2 text-xs text-muted-foreground">
          <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>{vault.t('device_protection.pin_recovery_warning')}</p>
        </div>
        <Button
          class="mt-2 h-auto px-0 text-xs"
          variant="link"
          disabled={vault.isVerifying}
          data-testid="device-protection-recovery-btn"
          onclick={recover}
        >
          {vault.t('device_protection.pin_recovery_action')}
        </Button>
      </div>
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
