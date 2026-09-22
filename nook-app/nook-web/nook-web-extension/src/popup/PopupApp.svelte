<script lang="ts">
  type RunDeviceActionArgs = {
    action: () => Promise<ExtensionSessionDeviceWire>
    fallbackKey?: I18nKey
  }

  type ErrorMessageArgs = {
    caught: Error
    fallbackKey: I18nKey
  }

  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { KeyRound, ShieldCheck } from '@lucide/svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import {
    ExtensionTranslationRequestKind,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
    extensionLocaleCatalog,
  } from '../lib/i18n'
  import {
    DeviceMode,
    DeviceProtectionStatus,
    ExtensionSessionDeviceStateKind,
    type ExtensionSessionDeviceWire,
    type ExtensionSessionDeviceState,
    type CompanionVaultSummaryArgs,
    extensionWasmRuntime,
  } from '../lib/nook-wasm'
  import {
    PairingCandidateKind,
    type PairingCandidate,
    CompanionSecretCountKind,
    type CompanionSecretCount,
  } from './popup-app-state'
  import { DeviceProtectionSetupWorkflow } from '../../../nook-web-shared/src/vault-app/lib/components/device-protection-gate-state'

  let {
    i18n,
    isConnected,
    vaultName,
    vaultStoreId,
    pairingRequested = false,
    protectionStatus,
    activeSessionDevice,
  }: {
    i18n: ExtensionI18n
    isConnected: boolean
    vaultName?: string
    vaultStoreId?: string
    pairingRequested?: boolean
    protectionStatus: DeviceProtectionStatus
    activeSessionDevice: ExtensionSessionDeviceState
  } = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  function initialProtectionStatus(): DeviceProtectionStatus {
    return protectionStatus
  }

  let status = $state<DeviceProtectionStatus>(initialProtectionStatus())
  let busy = $state(false)
  let error = $state('')
  let passkeyLabel = $state('')
  let deviceMode = $state<DeviceMode>(DeviceMode.Standard)
  let setupWorkflow = $state(DeviceProtectionSetupWorkflow.Authenticate)
  let pin = $state('')
  let pinConfirm = $state('')
  let pairingCandidate = $state<PairingCandidate>({
    kind: PairingCandidateKind.NotSelected,
  })
  let secretCount = $state<CompanionSecretCount>({
    kind: CompanionSecretCountKind.Unavailable,
  })

  const needsSetup = $derived(
    status === DeviceProtectionStatus.Missing ||
      status === DeviceProtectionStatus.Plaintext,
  )
  const showToolbarMenu = $derived(status === DeviceProtectionStatus.Unlocked)
  const showExistingConnection = $derived(isConnected && !pairingRequested)

  function connectedVaultLabel(vault: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionCompanionReadyVault,
      replacements: { vault },
    }
    return i18n.t(request)
  }

  function readyDescription(vault: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionCompanionReadyDescription,
      replacements: { vault },
    }
    return i18n.t(request)
  }

  function secretCountValue(): string {
    if (secretCount.kind === CompanionSecretCountKind.Available)
      return String(secretCount.count)
    return translatePlain(
      secretCount.kind === CompanionSecretCountKind.Loading
        ? I18N_KEYS.ExtensionCompanionLoading
        : I18N_KEYS.ExtensionCompanionUnavailable,
    )
  }

  async function loadSecretCount(
    device: ExtensionSessionDeviceWire,
  ): Promise<void> {
    if (!isConnected || !vaultStoreId) {
      secretCount = { kind: CompanionSecretCountKind.Unavailable }
      return
    }
    secretCount = { kind: CompanionSecretCountKind.Loading }
    try {
      const summaryArgs: CompanionVaultSummaryArgs = {
        vaultStoreId,
        appId: device.deviceId,
        appPublicKey: device.devicePublicKey,
        appSigningPublicKey: device.deviceSigningPublicKey,
      }
      const summary =
        await extensionWasmRuntime.extensionVaultSummary(summaryArgs)
      secretCount = {
        kind: CompanionSecretCountKind.Available,
        count: summary.secretCount,
      }
    } catch {
      secretCount = { kind: CompanionSecretCountKind.Unavailable }
    }
  }

  function isOkResponse(response: unknown): boolean {
    return Boolean(
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true,
    )
  }

  function errorMessage(args: ErrorMessageArgs): string {
    const { caught, fallbackKey } = args
    if (!(caught instanceof Error)) return translatePlain(fallbackKey)
    if (caught.message.includes('PASSKEY_CEREMONY_NOT_ALLOWED')) {
      return translatePlain(fallbackKey)
    }
    if (
      caught.message.includes('EXTENSION_SESSION_REQUEST_EXPIRED') ||
      caught.message.includes('EXTENSION_SESSION_LOCKED')
    ) {
      return translatePlain(I18N_KEYS.ExtensionSetupSessionBusyRetry)
    }
    return translatePlain(fallbackKey)
  }

  function openSimpleVault(): void {
    error = ''
    const message: { type: string } = { type: 'nook:open-simple-vault' }
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError || !isOkResponse(response)) {
        error = translatePlain(I18N_KEYS.ExtensionConnectStartFailed)
        return
      }
      window.close()
    })
  }
  function closeCompanion(): void {
    window.close()
  }

  function beginPairing(device: ExtensionSessionDeviceWire): void {
    busy = true
    error = ''
    const message: {
      type: string
      payload: ExtensionSessionDeviceWire & { deviceLabel: string }
    } = {
      type: 'nook:begin-extension-pairing',
      payload: {
        ...device,
        deviceLabel: translatePlain(I18N_KEYS.ExtensionSetupProfileTitle),
      },
    }
    chrome.runtime.sendMessage(message, (response: unknown) => {
      busy = false
      if (chrome.runtime.lastError || !isOkResponse(response)) {
        error = translatePlain(I18N_KEYS.ExtensionConnectStartFailed)
        return
      }
      window.close()
    })
  }

  function enterToolbarMenu(device: ExtensionSessionDeviceWire): void {
    pairingCandidate = { kind: PairingCandidateKind.Selected, device }
    status = DeviceProtectionStatus.Unlocked
    busy = false
    error = ''
    void loadSecretCount(device)
  }

  $effect(() => {
    if (activeSessionDevice.kind !== ExtensionSessionDeviceStateKind.Active)
      return
    enterToolbarMenu(activeSessionDevice.device)
  })

  async function runDeviceAction(args: RunDeviceActionArgs): Promise<void> {
    const { action, fallbackKey = I18N_KEYS.ExtensionSetupPasskeySetupFailed } =
      args
    busy = true
    error = ''
    try {
      const device = await action()
      enterToolbarMenu(device)
    } catch (caught) {
      busy = false
      const failure = caught instanceof Error ? caught : new Error()
      if (
        failure.message.includes('PASSKEY_UNAVAILABLE') ||
        failure.message.includes('PASSKEY_PRF_UNAVAILABLE')
      ) {
        status = DeviceProtectionStatus.PinSetup
        error = translatePlain(
          failure.message.includes('PASSKEY_UNAVAILABLE')
            ? I18N_KEYS.DeviceProtectionPasskeyUnavailablePinFallbackReady
            : I18N_KEYS.DeviceProtectionPinFallbackReady,
        )
        return
      }
      const errorArgs: Parameters<typeof errorMessage>[0] = {
        caught: failure,
        fallbackKey,
      }
      error = errorMessage(errorArgs)
    }
  }

  function createPasskey(): void {
    const args: Parameters<typeof runDeviceAction>[0] = {
      action: () => {
        const createArgs: Parameters<
          typeof extensionWasmRuntime.createExtensionPasskey
        >[0] = {
          passkeyLabel,
          deviceMode,
        }
        return extensionWasmRuntime.createExtensionPasskey(createArgs)
      },
      fallbackKey: I18N_KEYS.DeviceProtectionPasskeyCreateNotAllowed,
    }
    void runDeviceAction(args)
  }

  function useExistingPasskey(): void {
    const args: Parameters<typeof runDeviceAction>[0] = {
      action:
        extensionWasmRuntime.recoverExtensionPasskey.bind(extensionWasmRuntime),
      fallbackKey: I18N_KEYS.DeviceProtectionPasskeyRecoveryNotAllowed,
    }
    void runDeviceAction(args)
  }

  function unlockPasskey(): void {
    const args: Parameters<typeof runDeviceAction>[0] = {
      action:
        extensionWasmRuntime.unlockExtensionPasskey.bind(extensionWasmRuntime),
      fallbackKey: I18N_KEYS.DeviceProtectionPasskeyUnlockNotAllowed,
    }
    void runDeviceAction(args)
  }

  function createPin(): void {
    if (pin !== pinConfirm) {
      error = translatePlain(I18N_KEYS.DeviceProtectionPinMismatch)
      return
    }
    const args: Parameters<typeof runDeviceAction>[0] = {
      action: () => extensionWasmRuntime.createExtensionPin(pin),
      fallbackKey: I18N_KEYS.DeviceProtectionPinSetupFailed,
    }
    void runDeviceAction(args)
  }

  function unlockPin(): void {
    const args: Parameters<typeof runDeviceAction>[0] = {
      action: () => extensionWasmRuntime.unlockExtensionPin(pin),
      fallbackKey: I18N_KEYS.DeviceProtectionPinUnlockFailed,
    }
    void runDeviceAction(args)
  }
</script>

{#if showToolbarMenu}
  <main class="toolbar-menu" data-testid="extension-toolbar-menu">
    <header class="companion-header">
      <div class="companion-brand-row">
        <NookIcon src="../icons/nook.png" alt="" class="popup-logo menu-logo" />
        <div class="companion-brand-copy">
          <p class="step-label">
            {translatePlain(I18N_KEYS.ExtensionCompanionStepLabel)}
          </p>
          <div
            class:connected={isConnected}
            class="companion-state"
            data-testid="companion-vault-status"
            data-connected={isConnected}
          >
            <span aria-hidden="true"></span>
            {isConnected && vaultName
              ? connectedVaultLabel(vaultName)
              : translatePlain(I18N_KEYS.ExtensionCompanionNotConnected)}
          </div>
        </div>
      </div>

      <h1 data-testid="companion-title">
        {translatePlain(
          isConnected
            ? I18N_KEYS.ExtensionCompanionReadyTitle
            : I18N_KEYS.ExtensionCompanionConnectTitle,
        )}
      </h1>
      <p class="companion-description" data-testid="companion-description">
        {isConnected && vaultName
          ? readyDescription(vaultName)
          : translatePlain(I18N_KEYS.ExtensionCompanionConnectDescription)}
      </p>
    </header>

    <section class="secret-summary" aria-live="polite">
      <div>
        <span
          >{translatePlain(I18N_KEYS.ExtensionCompanionSecretsAvailable)}</span
        >
        <strong data-testid="companion-secret-count"
          >{secretCountValue()}</strong
        >
      </div>
    </section>

    <section
      class:connected={isConnected}
      class="companion-relationship"
      aria-label={translatePlain(I18N_KEYS.ExtensionCompanionRelationship)}
    >
      <div class="relationship-node">
        <span>{translatePlain(I18N_KEYS.ExtensionCompanionIdentity)}</span>
        <strong data-testid="companion-identity-status">
          {translatePlain(
            isConnected
              ? I18N_KEYS.ExtensionCompanionLinked
              : I18N_KEYS.ExtensionCompanionProtected,
          )}
        </strong>
      </div>
      <div class="relationship-connector" aria-hidden="true">
        <span></span>
      </div>
      <div class="relationship-node">
        <span>{translatePlain(I18N_KEYS.ExtensionCompanionVault)}</span>
        <strong data-testid="companion-connection-status">
          {translatePlain(
            isConnected
              ? I18N_KEYS.ExtensionCompanionConnected
              : I18N_KEYS.ExtensionCompanionNotConnected,
          )}
        </strong>
      </div>
    </section>

    <div class="companion-actions">
      {#if showExistingConnection}
        <button
          type="button"
          data-testid="open-simple-vault-btn"
          onclick={openSimpleVault}
        >
          {translatePlain(I18N_KEYS.ExtensionSetupOpenSimpleVault)}
        </button>
      {:else}
        <button
          type="button"
          disabled={busy ||
            pairingCandidate.kind !== PairingCandidateKind.Selected}
          data-testid="connect-simple-vault-btn"
          onclick={() => {
            if (pairingCandidate.kind === PairingCandidateKind.Selected)
              beginPairing(pairingCandidate.device)
          }}
        >
          {busy
            ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
            : translatePlain(
                pairingRequested
                  ? I18N_KEYS.ExtensionCompanionPairAnotherVault
                  : I18N_KEYS.ExtensionSetupConnectSimpleVault,
              )}
        </button>
        <button
          type="button"
          class="secondary-button"
          data-testid="open-simple-vault-btn"
          onclick={openSimpleVault}
        >
          {translatePlain(I18N_KEYS.ExtensionSetupOpenSimpleVault)}
        </button>
      {/if}

      <div class="companion-footer-actions">
        {#if showExistingConnection && pairingCandidate.kind === PairingCandidateKind.Selected}
          <button
            type="button"
            class="menu-secondary-action"
            disabled={busy}
            data-testid="pair-another-vault-btn"
            onclick={() => {
              if (pairingCandidate.kind === PairingCandidateKind.Selected)
                beginPairing(pairingCandidate.device)
            }}
          >
            {translatePlain(I18N_KEYS.ExtensionCompanionPairAnotherVault)}
          </button>
        {/if}
        <button
          type="button"
          class="menu-secondary-action"
          data-testid="companion-done-btn"
          onclick={closeCompanion}
        >
          {translatePlain(I18N_KEYS.ExtensionCompanionDone)}
        </button>
      </div>
    </div>

    {#if error}
      <p class="error-message" role="alert">{error}</p>
    {/if}
  </main>
{:else}
  <main class="device-setup" data-testid="extension-device-setup">
    <p class="step-label">
      {translatePlain(I18N_KEYS.DeviceProtectionStepLabel)}
    </p>
    <div class="shield-icon" aria-hidden="true">
      {#if needsSetup || status === DeviceProtectionStatus.PinSetup}
        <ShieldCheck size={26} />
      {:else}
        <KeyRound size={25} />
      {/if}
    </div>
    <h1>{translatePlain(I18N_KEYS.DeviceProtectionTitle)}</h1>
    <p class="description">
      {translatePlain(
        status === DeviceProtectionStatus.Passkey ||
          status === DeviceProtectionStatus.Unlocked
          ? I18N_KEYS.DeviceProtectionUnlockDescription
          : status === DeviceProtectionStatus.Pin
            ? I18N_KEYS.DeviceProtectionPinUnlockDescription
            : status === DeviceProtectionStatus.PinSetup
              ? I18N_KEYS.DeviceProtectionPinSetupDescription
              : I18N_KEYS.DeviceProtectionSetupDescription,
      )}
    </p>

    {#if status === DeviceProtectionStatus.PinSetup}
      <div class="field-group">
        <label for="device-protection-pin">
          {translatePlain(I18N_KEYS.DeviceProtectionPinLabel)}
        </label>
        <input
          id="device-protection-pin"
          type="password"
          inputmode="numeric"
          autocomplete="new-password"
          bind:value={pin}
          disabled={busy}
          data-testid="device-protection-pin-input"
        />
      </div>
      <div class="field-group">
        <label for="device-protection-pin-confirm">
          {translatePlain(I18N_KEYS.DeviceProtectionPinConfirmLabel)}
        </label>
        <input
          id="device-protection-pin-confirm"
          type="password"
          inputmode="numeric"
          autocomplete="new-password"
          bind:value={pinConfirm}
          disabled={busy}
          data-testid="device-protection-pin-confirm"
        />
      </div>
      <p class="field-hint">
        {translatePlain(I18N_KEYS.DeviceProtectionPinSecurityNote)}
      </p>
      <button
        type="button"
        disabled={busy}
        data-testid="device-protection-pin-setup-btn"
        onclick={createPin}
      >
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : translatePlain(I18N_KEYS.DeviceProtectionPinSetupAction)}
      </button>
    {:else if needsSetup && setupWorkflow === DeviceProtectionSetupWorkflow.Authenticate}
      <p class="field-hint">
        {translatePlain(I18N_KEYS.DeviceProtectionExistingPasskeyHint)}
      </p>
      <button
        type="button"
        disabled={busy}
        data-testid="device-protection-use-existing-choice"
        onclick={useExistingPasskey}
      >
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : translatePlain(I18N_KEYS.DeviceProtectionExistingPasskeyAction)}
      </button>

      <div class="divider">
        <span></span>
        <small
          >{translatePlain(
            I18N_KEYS.DeviceProtectionNewPasskeyAlternative,
          )}</small
        >
        <span></span>
      </div>
      <button
        type="button"
        class="alternative-button"
        disabled={busy}
        data-testid="device-protection-create-new-choice"
        onclick={() => {
          setupWorkflow = DeviceProtectionSetupWorkflow.Create
          error = ''
        }}
      >
        <KeyRound size={17} />
        {translatePlain(I18N_KEYS.DeviceProtectionNewPasskeyAlternativeAction)}
      </button>
    {:else if needsSetup}
      <div class="field-group">
        <label for="device-protection-mode">
          {translatePlain(I18N_KEYS.DeviceProtectionModeGroupLabel)}
        </label>
        <select
          id="device-protection-mode"
          bind:value={deviceMode}
          disabled={busy}
          data-testid="device-mode-select"
        >
          <option value={DeviceMode.Standard}>
            {translatePlain(I18N_KEYS.DeviceProtectionModeStandardTitle)}
          </option>
          <option value={DeviceMode.AntiHacker}>
            {translatePlain(I18N_KEYS.DeviceProtectionModeAntiHackerTitle)}
          </option>
        </select>
        <p class="field-hint">
          {translatePlain(
            deviceMode === DeviceMode.Standard
              ? I18N_KEYS.DeviceProtectionModeStandardDescription
              : I18N_KEYS.DeviceProtectionModeAntiHackerDescription,
          )}
        </p>
      </div>

      <div class="field-group">
        <label for="device-protection-label">
          {translatePlain(I18N_KEYS.DeviceProtectionPasskeyLabel)}
        </label>
        <input
          id="device-protection-label"
          type="text"
          autocomplete="off"
          placeholder={translatePlain(
            I18N_KEYS.DeviceProtectionPasskeyLabelPlaceholder,
          )}
          bind:value={passkeyLabel}
          disabled={busy}
          data-testid="device-protection-label-input"
        />
      </div>
      <button
        type="button"
        disabled={busy}
        data-testid="device-protection-setup-btn"
        onclick={createPasskey}
      >
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : translatePlain(I18N_KEYS.DeviceProtectionSetupAction)}
      </button>

      <div class="divider">
        <span></span>
        <small
          >{translatePlain(
            I18N_KEYS.DeviceProtectionExistingPasskeyAlternative,
          )}</small
        >
        <span></span>
      </div>
      <button
        type="button"
        class="alternative-button"
        disabled={busy}
        data-testid="device-protection-use-existing-choice"
        onclick={useExistingPasskey}
      >
        <KeyRound size={17} />
        {translatePlain(I18N_KEYS.DeviceProtectionExistingPasskeyAction)}
      </button>
    {:else if status === DeviceProtectionStatus.Pin}
      <div class="field-group">
        <label for="device-protection-pin">
          {translatePlain(I18N_KEYS.DeviceProtectionPinLabel)}
        </label>
        <input
          id="device-protection-pin"
          type="password"
          inputmode="numeric"
          autocomplete="current-password"
          bind:value={pin}
          disabled={busy}
          data-testid="device-protection-pin-unlock-input"
        />
      </div>
      <button
        type="button"
        disabled={busy}
        data-testid="device-protection-pin-unlock-btn"
        onclick={unlockPin}
      >
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : translatePlain(I18N_KEYS.DeviceProtectionPinUnlockAction)}
      </button>
    {:else}
      <button
        type="button"
        disabled={busy}
        data-testid="device-protection-unlock-btn"
        onclick={unlockPasskey}
      >
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : translatePlain(I18N_KEYS.DeviceProtectionUnlockAction)}
      </button>
    {/if}

    {#if error}
      <p
        class="error-message"
        role="alert"
        data-testid="device-protection-error"
      >
        {error}
      </p>
    {/if}
  </main>
{/if}
