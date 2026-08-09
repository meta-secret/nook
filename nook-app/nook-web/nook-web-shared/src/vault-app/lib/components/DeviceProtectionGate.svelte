<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { CircleHelp, KeyRound, ShieldCheck } from '@lucide/svelte'
  import { DeviceProtectionStatus } from '$app-wasm'
  import * as deviceProtectionActions from '$lib/vault/device-protection.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'
  import DeviceModeSelect from '$lib/components/DeviceModeSelect.svelte'
  import ExistingVaultRecoverySummary from '$lib/components/ExistingVaultRecoverySummary.svelte'
  import {
    DeviceProtectionGateFrame,
    DeviceProtectionSetupWorkflow,
  } from './device-protection-gate-state'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'

  let {
    vault,
    frame,
    onProtectionReady,
  }: {
    vault: VaultState
    frame: DeviceProtectionGateFrame
    onProtectionReady: () => void
  } = $props()
  let pin = $state('')
  let pinConfirm = $state('')
  let passkeyLabel = $state('')
  let setupWorkflow = $state(DeviceProtectionSetupWorkflow.Authenticate)

  const needsSetup = $derived(
    vault.deviceProtectionStatus === DeviceProtectionStatus.Missing ||
      vault.deviceProtectionStatus === DeviceProtectionStatus.Plaintext ||
      vault.deviceProtectionStatus === DeviceProtectionStatus.PinSetup,
  )

  function recover() {
    if (!confirm(vault.t(I18N_KEYS.DeviceProtectionRecoveryConfirm))) {
      return
    }
    void deviceProtectionActions.resetDeviceProtectionForRecovery(vault)
  }

  async function completeProtectionAction(
    action: () => Promise<void>,
  ): Promise<void> {
    await action()
    if (vault.deviceProtectionStatus === DeviceProtectionStatus.Unlocked) {
      onProtectionReady()
    }
  }
</script>

<Card
  class="mx-auto w-full max-w-lg gap-4 py-5 rounded-none border-0 bg-transparent shadow-none animate-in fade-in duration-300"
  data-testid="device-protection-gate"
>
  <CardHeader class="gap-2 text-center">
    <!-- The step counter belongs to the two-step vault setup flow; a host that
         already frames this gate in its own narrative shows no step. -->
    {#if frame === DeviceProtectionGateFrame.SetupStep}
      <p
        class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        data-testid="device-protection-step"
      >
        {vault.t(I18N_KEYS.DeviceProtectionStepLabel)}
      </p>
    {/if}
    <div
      class="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
    >
      {#if needsSetup}
        <ShieldCheck class="size-6" />
      {:else}
        <KeyRound class="size-6" />
      {/if}
    </div>
    <CardTitle data-testid="device-protection-title">
      {vault.t(I18N_KEYS.DeviceProtectionTitle)}
    </CardTitle>
    <CardDescription class="leading-snug">
      {#if vault.deviceProtectionStatus === DeviceProtectionStatus.Plaintext}
        {vault.t(I18N_KEYS.DeviceProtectionMigrationDescription)}
      {:else if vault.deviceProtectionStatus === DeviceProtectionStatus.PinSetup}
        {vault.t(I18N_KEYS.DeviceProtectionPinSetupDescription)}
      {:else if vault.deviceProtectionStatus === DeviceProtectionStatus.Pin}
        {vault.t(I18N_KEYS.DeviceProtectionPinUnlockDescription)}
      {:else if vault.deviceProtectionStatus === DeviceProtectionStatus.Passkey}
        {vault.t(I18N_KEYS.DeviceProtectionUnlockDescription)}
      {:else if vault.deviceProtectionStatus === DeviceProtectionStatus.Error}
        {vault.t(I18N_KEYS.DeviceProtectionUnavailableDescription)}
      {:else}
        {vault.t(I18N_KEYS.DeviceProtectionSetupDescription)}
      {/if}
    </CardDescription>
  </CardHeader>

  <CardContent class="space-y-3">
    <ExistingVaultRecoverySummary {vault} />

    {#if vault.deviceProtectionStatus === DeviceProtectionStatus.PinSetup}
      <div class="space-y-2">
        <label class="block text-sm font-medium" for="device-protection-pin">
          {vault.t(I18N_KEYS.DeviceProtectionPinLabel)}
        </label>
        <input
          id="device-protection-pin"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          type="password"
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
          {vault.t(I18N_KEYS.DeviceProtectionPinConfirmLabel)}
        </label>
        <input
          id="device-protection-pin-confirm"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          type="password"
          autocomplete="new-password"
          bind:value={pinConfirm}
          disabled={vault.isVerifying}
          data-testid="device-protection-pin-confirm"
        />
      </div>
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.DeviceProtectionPinSecurityNote)}
      </p>
      <Button
        class="w-full"
        disabled={vault.isVerifying}
        data-testid="device-protection-pin-setup-btn"
        onclick={() =>
          void completeProtectionAction(() => {
            const setupRequest: Parameters<
              typeof deviceProtectionActions.setupPinDeviceProtection
            >[0] = { state: vault, pin, confirmPin: pinConfirm }
            return deviceProtectionActions.setupPinDeviceProtection(setupRequest)
          })}
      >
        {vault.isVerifying
          ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
          : vault.t(I18N_KEYS.DeviceProtectionPinSetupAction)}
      </Button>
    {:else if needsSetup}
      {#if setupWorkflow === DeviceProtectionSetupWorkflow.Authenticate}
        <div
          class="space-y-4"
          data-testid="device-protection-authenticate-workflow"
        >
          <p class="text-center text-sm text-muted-foreground">
            {vault.t(I18N_KEYS.DeviceProtectionExistingPasskeyHint)}
          </p>
          <Button
            class="w-full"
            disabled={vault.isVerifying}
            data-testid="device-protection-use-existing-choice"
            onclick={() =>
              void completeProtectionAction(() =>
                deviceProtectionActions.recoverDeviceProtectionWithPasskey(
                  vault,
                ),
              )}
          >
            <KeyRound class="size-4" />
            {vault.isVerifying
              ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
              : vault.t(I18N_KEYS.DeviceProtectionExistingPasskeyAction)}
          </Button>
          <div class="flex items-center gap-3 pt-1">
            <div class="h-px flex-1 bg-border"></div>
            <span class="text-xs text-muted-foreground">
              {vault.t(I18N_KEYS.DeviceProtectionNewPasskeyAlternative)}
            </span>
            <div class="h-px flex-1 bg-border"></div>
          </div>
          <Button
            class="mx-auto flex text-foreground/80 hover:bg-accent/50 hover:text-foreground"
            variant="ghost"
            size="sm"
            disabled={vault.isVerifying}
            data-testid="device-protection-create-new-choice"
            onclick={() => {
              setupWorkflow = DeviceProtectionSetupWorkflow.Create
              vault.dismissError()
            }}
          >
            <KeyRound class="size-4" />
            {vault.t(I18N_KEYS.DeviceProtectionNewPasskeyAlternativeAction)}
          </Button>
        </div>
      {:else}
        <div class="space-y-4" data-testid="device-protection-create-workflow">
          <DeviceModeSelect
            {vault}
            id="device-protection-mode"
            disabled={vault.isVerifying}
          />

          <div class="space-y-2">
            <label
              class="block text-sm font-medium"
              for="device-protection-label"
            >
              {vault.t(I18N_KEYS.DeviceProtectionPasskeyLabel)}
            </label>
            <input
              id="device-protection-label"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              type="text"
              autocomplete="off"
              placeholder={vault.t(
                I18N_KEYS.DeviceProtectionPasskeyLabelPlaceholder,
              )}
              bind:value={passkeyLabel}
              disabled={vault.isVerifying}
              data-testid="device-protection-label-input"
            />
          </div>
          <Button
            class="w-full"
            disabled={vault.isVerifying}
            data-testid="device-protection-setup-btn"
            onclick={() =>
              void completeProtectionAction(() => {
                const setupRequest: Parameters<
                  typeof deviceProtectionActions.setupDeviceProtection
                >[0] = {
                  state: vault,
                  passkeyLabel,
                  deviceMode: vault.draftDeviceMode,
                }
                return deviceProtectionActions.setupDeviceProtection(setupRequest)
              })}
          >
            {vault.isVerifying
              ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
              : vault.t(I18N_KEYS.DeviceProtectionSetupAction)}
          </Button>
          <div class="flex items-center gap-3 pt-1">
            <div class="h-px flex-1 bg-border"></div>
            <span class="text-xs text-muted-foreground">
              {vault.t(I18N_KEYS.DeviceProtectionExistingPasskeyAlternative)}
            </span>
            <div class="h-px flex-1 bg-border"></div>
          </div>
          <Button
            class="mx-auto flex text-foreground/80 hover:bg-accent/50 hover:text-foreground"
            variant="ghost"
            size="sm"
            disabled={vault.isVerifying}
            data-testid="device-protection-use-existing-choice"
            onclick={() =>
              void completeProtectionAction(() =>
                deviceProtectionActions.recoverDeviceProtectionWithPasskey(
                  vault,
                ),
              )}
          >
            <KeyRound class="size-4" />
            {vault.isVerifying
              ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
              : vault.t(I18N_KEYS.DeviceProtectionExistingPasskeyAction)}
          </Button>
        </div>
      {/if}
    {:else if vault.deviceProtectionStatus === DeviceProtectionStatus.Pin}
      <div class="space-y-2">
        <label class="block text-sm font-medium" for="device-protection-pin">
          {vault.t(I18N_KEYS.DeviceProtectionPinLabel)}
        </label>
        <input
          id="device-protection-pin"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          type="password"
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
        onclick={() => {
          const unlockRequest: Parameters<
            typeof deviceProtectionActions.unlockPinDeviceProtection
          >[0] = { state: vault, pin }
          return deviceProtectionActions.unlockPinDeviceProtection(unlockRequest)
        }}
      >
        {vault.isVerifying
          ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
          : vault.t(I18N_KEYS.DeviceProtectionPinUnlockAction)}
      </Button>

      <div class="rounded-md border border-border/60 bg-muted/20 p-3">
        <div class="flex gap-2 text-xs text-muted-foreground">
          <CircleHelp class="mt-0.5 size-4 shrink-0" />
          <p>{vault.t(I18N_KEYS.DeviceProtectionPinRecoveryWarning)}</p>
        </div>
        <Button
          class="mt-2 h-auto px-0 text-xs"
          variant="link"
          disabled={vault.isVerifying}
          data-testid="device-protection-recovery-btn"
          onclick={recover}
        >
          {vault.t(I18N_KEYS.DeviceProtectionPinRecoveryAction)}
        </Button>
      </div>
    {:else if vault.deviceProtectionStatus === DeviceProtectionStatus.Passkey}
      <Button
        class="w-full"
        disabled={vault.isVerifying}
        data-testid="device-protection-unlock-btn"
        onclick={() => deviceProtectionActions.unlockDeviceProtection(vault)}
      >
        {vault.isVerifying
          ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
          : vault.t(I18N_KEYS.DeviceProtectionUnlockAction)}
      </Button>

      <div class="rounded-md border border-border/60 bg-muted/20 p-3">
        <div class="flex gap-2 text-xs text-muted-foreground">
          <CircleHelp class="mt-0.5 size-4 shrink-0" />
          <p>{vault.t(I18N_KEYS.DeviceProtectionRecoveryWarning)}</p>
        </div>
        <Button
          class="mt-2 h-auto px-0 text-xs"
          variant="link"
          disabled={vault.isVerifying}
          data-testid="device-protection-recovery-btn"
          onclick={recover}
        >
          {vault.t(I18N_KEYS.DeviceProtectionRecoveryAction)}
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
