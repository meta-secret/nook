<script lang="ts">
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { KeyRound, ShieldCheck } from '@lucide/svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import {
    ExtensionTranslationRequestKind,
    plainExtensionTranslation,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
  } from '../lib/i18n'
  import { LoginDetectionStatus } from '../lib/login-detection-messages'
  import {
    createExtensionPasskey,
    createExtensionPin,
    DeviceMode,
    DeviceProtectionStatus,
    ExtensionSessionDeviceStateKind,
    recoverExtensionPasskey,
    unlockExtensionPasskey,
    unlockExtensionPin,
    type ExtensionDeviceProtectionResult,
    type ExtensionSessionDeviceState,
  } from '../lib/nook-wasm'
  import {
    PairingCandidateKind,
    LoginDetectionViewKind,
    type PairingCandidate,
    type LoginDetectionView,
  } from './popup-app-state'
  import { DeviceProtectionSetupWorkflow } from '../../../nook-web-shared/src/vault-app/lib/components/device-protection-gate-state'

  let {
    i18n,
    isConnected,
    vaultName,
    pairingRequested = false,
    protectionStatus,
    activeSessionDevice,
  }: {
    i18n: ExtensionI18n
    isConnected: boolean
    vaultName?: string
    pairingRequested?: boolean
    protectionStatus: DeviceProtectionStatus
    activeSessionDevice: ExtensionSessionDeviceState
  } = $props()

  function translatePlain(key: string): string {
    return i18n.t(plainExtensionTranslation(key))
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
  let loginDetectionView = $state<LoginDetectionView>({
    kind: LoginDetectionViewKind.Loading,
  })

  const needsSetup = $derived(
    status === DeviceProtectionStatus.Missing ||
      status === DeviceProtectionStatus.Plaintext,
  )
  const showCompanionHome = $derived(status === DeviceProtectionStatus.Unlocked)
  const showExistingConnection = $derived(isConnected && !pairingRequested)

  const loginDetectionKey = $derived(
    loginDetectionView.kind === LoginDetectionViewKind.Loading
      ? I18N_KEYS.ExtensionCompanionLoginChecking
      : loginDetectionView.status === LoginDetectionStatus.Detected
        ? I18N_KEYS.ExtensionCompanionLoginDetected
        : loginDetectionView.status === LoginDetectionStatus.NotDetected
          ? I18N_KEYS.ExtensionCompanionLoginNotDetected
          : loginDetectionView.status === LoginDetectionStatus.Unavailable
            ? I18N_KEYS.ExtensionCompanionLoginUnavailable
            : I18N_KEYS.ExtensionCompanionLoginChecking,
  )

  function connectedVaultLabel(vault: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionCompanionReadyVault,
      replacements: { vault },
    }
    return i18n.t(request)
  }

  function isOkResponse(response: unknown): boolean {
    return Boolean(
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true,
    )
  }

  function refreshLoginDetection(): void {
    loginDetectionView = { kind: LoginDetectionViewKind.Loading }
    chrome.runtime.sendMessage(
      { type: 'nook:query-active-tab-login-detection' },
      (response: unknown) => {
        if (
          chrome.runtime.lastError ||
          !isOkResponse(response) ||
          !response ||
          typeof response !== 'object' ||
          !('status' in response) ||
          (response.status !== LoginDetectionStatus.Detected &&
            response.status !== LoginDetectionStatus.NotDetected &&
            response.status !== LoginDetectionStatus.Unavailable)
        ) {
          loginDetectionView = {
            kind: LoginDetectionViewKind.Ready,
            status: LoginDetectionStatus.Unavailable,
          }
          return
        }
        loginDetectionView = {
          kind: LoginDetectionViewKind.Ready,
          status: response.status as LoginDetectionStatus,
        }
      },
    )
  }

  $effect(() => {
    if (!showCompanionHome) return
    refreshLoginDetection()
  })

  function errorMessage(caught: unknown, fallbackKey: string): string {
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
    chrome.runtime.sendMessage(
      { type: 'nook:open-simple-vault' },
      (response: unknown) => {
        if (chrome.runtime.lastError || !isOkResponse(response)) {
          error = translatePlain(I18N_KEYS.ExtensionConnectStartFailed)
          return
        }
        window.close()
      },
    )
  }

  function beginPairing(device: ExtensionDeviceProtectionResult): void {
    busy = true
    error = ''
    chrome.runtime.sendMessage(
      {
        type: 'nook:begin-extension-pairing',
        payload: {
          ...device,
          deviceLabel: translatePlain(I18N_KEYS.ExtensionSetupProfileTitle),
        },
      },
      (response: unknown) => {
        busy = false
        if (chrome.runtime.lastError || !isOkResponse(response)) {
          error = translatePlain(I18N_KEYS.ExtensionConnectStartFailed)
          return
        }
        window.close()
      },
    )
  }

  function stayAsCompanion(): void {
    window.close()
  }

  function enterCompanionHome(device: ExtensionDeviceProtectionResult): void {
    pairingCandidate = { kind: PairingCandidateKind.Selected, device }
    status = DeviceProtectionStatus.Unlocked
    busy = false
    error = ''
  }

  $effect(() => {
    if (activeSessionDevice.kind !== ExtensionSessionDeviceStateKind.Active)
      return
    enterCompanionHome(activeSessionDevice.device)
  })

  async function runDeviceAction(
    action: () => Promise<ExtensionDeviceProtectionResult>,
    fallbackKey: I18nKey = I18N_KEYS.ExtensionSetupPasskeySetupFailed,
  ): Promise<void> {
    busy = true
    error = ''
    try {
      enterCompanionHome(await action())
    } catch (caught) {
      busy = false
      if (
        caught instanceof Error &&
        (caught.message.includes('PASSKEY_UNAVAILABLE') ||
          caught.message.includes('PASSKEY_PRF_UNAVAILABLE'))
      ) {
        status = DeviceProtectionStatus.PinSetup
        error = translatePlain(
          caught.message.includes('PASSKEY_UNAVAILABLE')
            ? I18N_KEYS.DeviceProtectionPasskeyUnavailablePinFallbackReady
            : I18N_KEYS.DeviceProtectionPinFallbackReady,
        )
        return
      }
      error = errorMessage(caught, fallbackKey)
    }
  }

  function createPasskey(): void {
    void runDeviceAction(() => {
      const args = { passkeyLabel, deviceMode }
      return createExtensionPasskey(args)
    }, I18N_KEYS.DeviceProtectionPasskeyCreateNotAllowed)
  }

  function useExistingPasskey(): void {
    void runDeviceAction(
      recoverExtensionPasskey,
      I18N_KEYS.DeviceProtectionPasskeyRecoveryNotAllowed,
    )
  }

  function unlockPasskey(): void {
    void runDeviceAction(
      unlockExtensionPasskey,
      I18N_KEYS.DeviceProtectionPasskeyUnlockNotAllowed,
    )
  }

  function createPin(): void {
    if (pin !== pinConfirm) {
      error = translatePlain(I18N_KEYS.DeviceProtectionPinMismatch)
      return
    }
    void runDeviceAction(() => createExtensionPin(pin))
  }

  function unlockPin(): void {
    void runDeviceAction(() => unlockExtensionPin(pin))
  }
</script>

{#if showCompanionHome}
  <main class="companion-home" data-testid="extension-companion-home">
    <p class="step-label">
      {translatePlain(I18N_KEYS.ExtensionCompanionStepLabel)}
    </p>
    <NookIcon
      src="../icons/nook.png"
      alt=""
      class="popup-logo companion-logo"
    />
    <h1>
      {translatePlain(
        showExistingConnection
          ? I18N_KEYS.ExtensionCompanionReadyTitle
          : I18N_KEYS.ExtensionCompanionConnectTitle,
      )}
    </h1>
    <p class="description">
      {translatePlain(
        showExistingConnection
          ? I18N_KEYS.ExtensionCompanionReadyDescription
          : I18N_KEYS.ExtensionCompanionConnectDescription,
      )}
    </p>
    <p
      class="vault-connection"
      data-testid="companion-vault-status"
      data-connected={showExistingConnection ? 'true' : 'false'}
    >
      {showExistingConnection && vaultName
        ? connectedVaultLabel(vaultName)
        : translatePlain(I18N_KEYS.ExtensionCompanionNotConnected)}
    </p>
    <p
      class="login-detection"
      data-testid="companion-login-detection"
      data-status={loginDetectionView.kind === LoginDetectionViewKind.Ready
        ? loginDetectionView.status
        : LoginDetectionViewKind.Loading}
    >
      {translatePlain(loginDetectionKey)}
    </p>

    {#if showExistingConnection}
      <button
        type="button"
        data-testid="stay-as-companion-btn"
        onclick={stayAsCompanion}
      >
        {translatePlain(I18N_KEYS.ExtensionCompanionStayReady)}
      </button>
    {:else if pairingCandidate.kind === PairingCandidateKind.Selected}
      <button
        type="button"
        disabled={busy}
        data-testid="connect-simple-vault-btn"
        onclick={() => {
          if (pairingCandidate.kind === PairingCandidateKind.Selected)
            beginPairing(pairingCandidate.device)
        }}
      >
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : translatePlain(I18N_KEYS.ExtensionSetupConnectSimpleVault)}
      </button>
    {/if}

    <button
      type="button"
      class="secondary-button"
      data-testid="open-simple-vault-btn"
      onclick={openSimpleVault}
    >
      {translatePlain(I18N_KEYS.ExtensionSetupOpenSimpleVault)}
    </button>

    {#if !showExistingConnection}
      <button
        type="button"
        class="secondary-button"
        data-testid="stay-as-companion-btn"
        onclick={stayAsCompanion}
      >
        {translatePlain(I18N_KEYS.ExtensionCompanionNotNow)}
      </button>
    {/if}

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
