<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    ArrowDown,
    KeyRound,
    ShieldCheck,
    TriangleAlert,
  } from '@lucide/svelte'
  import { untrack } from 'svelte'
  import { DeviceProtectionStatus } from '$app-wasm'
  import * as deviceProtectionActions from '$lib/vault/device-protection.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'
  import DeviceModeSelect from '$lib/components/DeviceModeSelect.svelte'
  import ExistingVaultRecoverySummary from '$lib/components/ExistingVaultRecoverySummary.svelte'
  import DeviceRecoveryAction from '$lib/components/DeviceRecoveryAction.svelte'
  import { DeviceRecoveryKind } from './device-recovery'
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
    creationOnly,
    initializeSession,
    recoveryAppId,
    onBeforeProtectionAction,
    onProtectionActionSettled,
    onProtectionReady,
  }: {
    vault: VaultState
    frame: DeviceProtectionGateFrame
    creationOnly: boolean
    initializeSession: boolean
    recoveryAppId: string
    onBeforeProtectionAction: () => void
    onProtectionActionSettled?: () => void
    onProtectionReady: () => void
  } = $props()
  let pin = $state('')
  let pinConfirm = $state('')
  let passkeyLabel = $state('')
  let setupWorkflow = $state(
    untrack(() =>
      creationOnly
        ? DeviceProtectionSetupWorkflow.Create
        : DeviceProtectionSetupWorkflow.Authenticate,
    ),
  )

  const needsSetup = $derived(
    creationOnly ||
      vault.deviceProtectionStatus === DeviceProtectionStatus.Missing ||
      vault.deviceProtectionStatus === DeviceProtectionStatus.Plaintext ||
      vault.deviceProtectionStatus === DeviceProtectionStatus.PinSetup,
  )

  async function completeProtectionAction(
    action: () => Promise<deviceProtectionActions.DeviceProtectionActionOutcome>,
  ): Promise<void> {
    onBeforeProtectionAction()
    try {
      const outcome = await action()
      switch (outcome) {
        case deviceProtectionActions.DeviceProtectionActionOutcome.Ready:
          onProtectionReady()
          break
        case deviceProtectionActions.DeviceProtectionActionOutcome.Incomplete:
          break
        case deviceProtectionActions.DeviceProtectionActionOutcome
          .PasskeyNotAllowed:
          // A closed picker never proves that no passkey exists, so it never
          // starts creating one: the not-found step offers the choice in its
          // own words. Looking again from there keeps the notice instead.
          if (setupWorkflow !== DeviceProtectionSetupWorkflow.NotFound) {
            setupWorkflow = DeviceProtectionSetupWorkflow.NotFound
            vault.dismissError()
          }
          break
      }
    } finally {
      onProtectionActionSettled?.()
    }
  }
</script>

<Card
  class="w-full gap-4 rounded-none border-0 bg-transparent shadow-none animate-in fade-in duration-300 {frame ===
  DeviceProtectionGateFrame.Embedded
    ? 'max-w-md py-0'
    : 'mx-auto max-w-lg py-5'}"
  data-testid="device-protection-gate"
>
  {#if frame !== DeviceProtectionGateFrame.Embedded}
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
      class="nk-tile nk-tile-lg mx-auto text-foreground"
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
  {/if}

  <!-- Embedded in a host's own column, the content keeps that column's edge. -->
  <CardContent
    class="space-y-3 {frame === DeviceProtectionGateFrame.Embedded
      ? 'px-0'
      : ''}"
  >
    {#if !creationOnly}
      <ExistingVaultRecoverySummary {vault} />
    {/if}

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
              deviceProtectionActions.DeviceProtectionActions['setupPinDeviceProtection']
            >[0] = {
              pin,
              confirmPin: pinConfirm,
              initializeSession: initializeSession && !creationOnly,
            }
            return new deviceProtectionActions.DeviceProtectionActions(
              vault,
            ).setupPinDeviceProtection(setupRequest)
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
                new deviceProtectionActions.DeviceProtectionActions(
                  vault,
                ).recoverDeviceProtectionWithPasskey(),
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
      {:else if setupWorkflow === DeviceProtectionSetupWorkflow.NotFound}
        <div
          class="space-y-4"
          data-testid="device-protection-not-found-workflow"
        >
          <div
            class="nk-banner nk-banner-destructive flex gap-3 px-4 py-3"
            role="alert"
            data-testid="device-protection-not-found-alert"
          >
            <TriangleAlert
              class="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div class="space-y-1">
              <p class="text-sm font-medium text-destructive">
                {vault.t(I18N_KEYS.DeviceProtectionNotFoundTitle)}
              </p>
              <p class="text-sm text-foreground/80">
                {vault.t(I18N_KEYS.DeviceProtectionNotFoundDescription)}
              </p>
            </div>
          </div>
          <div class="space-y-2">
            <p
              class="nk-label nk-guide-cue flex items-center gap-1.5"
              data-testid="device-protection-next-step"
            >
              <ArrowDown class="size-3.5" aria-hidden="true" />
              {vault.t(I18N_KEYS.DeviceProtectionNextStep)}
            </p>
            <div class="nk-guide">
              <Button
                class="w-full"
                disabled={vault.isVerifying}
                data-testid="device-protection-create-new-choice"
                onclick={() => {
                  setupWorkflow = DeviceProtectionSetupWorkflow.Create
                  vault.dismissError()
                }}
                {@attach (button: HTMLButtonElement) => button.focus()}
              >
                <KeyRound class="size-4" />
                {vault.t(
                  I18N_KEYS.DeviceProtectionNewPasskeyAlternativeAction,
                )}
              </Button>
            </div>
          </div>
          <p class="text-center text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.DeviceProtectionPasskeyElsewhere)}
            <Button
              class="h-auto px-1 py-0 text-xs text-foreground/80 hover:bg-accent/50 hover:text-foreground"
              variant="ghost"
              size="sm"
              disabled={vault.isVerifying}
              data-testid="device-protection-use-existing-choice"
              onclick={() =>
                void completeProtectionAction(() =>
                  new deviceProtectionActions.DeviceProtectionActions(
                    vault,
                  ).recoverDeviceProtectionWithPasskey(),
                )}
            >
              {vault.isVerifying
                ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
                : vault.t(I18N_KEYS.DeviceProtectionUseExisting)}
            </Button>
          </p>
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
                  deviceProtectionActions.DeviceProtectionActions['setupDeviceProtection']
                >[0] = {
                  passkeyLabel,
                  deviceMode: vault.draftDeviceMode,
                  initializeSession: initializeSession && !creationOnly,
                }
                return new deviceProtectionActions.DeviceProtectionActions(
                  vault,
                ).setupDeviceProtection(setupRequest)
              })}
          >
            {vault.isVerifying
              ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
              : vault.t(I18N_KEYS.DeviceProtectionSetupAction)}
          </Button>
          {#if !creationOnly}
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
                  new deviceProtectionActions.DeviceProtectionActions(
                    vault,
                  ).recoverDeviceProtectionWithPasskey(),
                )}
            >
              <KeyRound class="size-4" />
              {vault.isVerifying
                ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
                : vault.t(I18N_KEYS.DeviceProtectionExistingPasskeyAction)}
            </Button>
          {/if}
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
        onclick={() =>
          void completeProtectionAction(() => {
            const unlockRequest: Parameters<
              deviceProtectionActions.DeviceProtectionActions['unlockPinDeviceProtection']
            >[0] = { pin, initializeSession }
            return new deviceProtectionActions.DeviceProtectionActions(
              vault,
            ).unlockPinDeviceProtection(unlockRequest)
          })}
      >
        {vault.isVerifying
          ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
          : vault.t(I18N_KEYS.DeviceProtectionPinUnlockAction)}
      </Button>

      <DeviceRecoveryAction
        {vault}
        kind={DeviceRecoveryKind.Pin}
        {recoveryAppId}
      />
    {:else if vault.deviceProtectionStatus === DeviceProtectionStatus.Passkey}
      <Button
        class="w-full"
        disabled={vault.isVerifying}
        data-testid="device-protection-unlock-btn"
        onclick={() =>
          void completeProtectionAction(() => {
            const unlockRequest: Parameters<
              deviceProtectionActions.DeviceProtectionActions['unlockDeviceProtection']
            >[0] = { initializeSession }
            return new deviceProtectionActions.DeviceProtectionActions(
              vault,
            ).unlockDeviceProtection(unlockRequest)
          })}
      >
        {vault.isVerifying
          ? vault.t(I18N_KEYS.DeviceProtectionAuthorizing)
          : vault.t(I18N_KEYS.DeviceProtectionUnlockAction)}
      </Button>

      <DeviceRecoveryAction
        {vault}
        kind={DeviceRecoveryKind.Passkey}
        {recoveryAppId}
      />
    {:else if vault.deviceProtectionStatus === DeviceProtectionStatus.Error && !creationOnly}
      <DeviceRecoveryAction
        {vault}
        kind={DeviceRecoveryKind.Unavailable}
        {recoveryAppId}
      />
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
