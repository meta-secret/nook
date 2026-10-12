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
  import {
    ExtensionTranslationRequestKind,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
    extensionLocaleCatalog,
  } from '../lib/i18n'
  import { OpenCompanionLauncherIntent } from '../../../nook-web-shared/src/extension/companion-launcher-message'
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

  let {
    i18n,
    isConnected,
    vaultName,
    vaultStoreId,
    launcherIntent,
    protectionStatus,
    activeSessionDevice,
  }: {
    i18n: ExtensionI18n
    isConnected: boolean
    vaultName?: string
    vaultStoreId?: string
    launcherIntent: OpenCompanionLauncherIntent
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
  const showExistingConnection = $derived(
    isConnected && launcherIntent !== OpenCompanionLauncherIntent.Pair,
  )

  function connectActionKey(): I18nKey {
    switch (launcherIntent) {
      case OpenCompanionLauncherIntent.Default:
      case OpenCompanionLauncherIntent.PilotAuth:
        return I18N_KEYS.ExtensionSetupConnectSimpleVault
      case OpenCompanionLauncherIntent.Pair:
        return I18N_KEYS.ExtensionCompanionPairAnotherVault
    }
  }

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

  function connectDescription(): string {
    return translatePlain(I18N_KEYS.ExtensionCompanionConnectDescription)
  }

  function connectedDescription(): string {
    switch (typeof vaultName) {
      case 'string':
        return readyDescription(vaultName)
      case 'undefined':
        return connectDescription()
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'object':
      case 'function':
        throw new Error('vault name has an invalid runtime type')
    }
  }

  function companionDescription(): string {
    switch (launcherIntent) {
      case OpenCompanionLauncherIntent.PilotAuth:
        return translatePlain(I18N_KEYS.ExtensionCompanionPilotReturnGuidance)
      case OpenCompanionLauncherIntent.Default:
      case OpenCompanionLauncherIntent.Pair:
        switch (isConnected) {
          case true:
            return connectedDescription()
          case false:
            return connectDescription()
        }
    }
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

<main
  class="companion-page"
  data-testid={showToolbarMenu
    ? 'extension-toolbar-menu'
    : 'extension-device-setup'}
>
  <header>
    <span class="brand-mark">n</span>
    <p class="eyebrow">
      {translatePlain(I18N_KEYS.ExtensionCompanionStepLabel)}
    </p>
    <h1>
      {translatePlain(
        showToolbarMenu
          ? I18N_KEYS.ExtensionCompanionReadyTitle
          : I18N_KEYS.DeviceProtectionTitle,
      )}
    </h1>
  </header>
  {#if error}<p
      class="error"
      role="alert"
      data-testid="extension-runtime-error"
    >
      {error}
    </p>{/if}
  {#if showToolbarMenu}
    <p>{companionDescription()}</p>
    <section class="connection-summary" data-testid="companion-vault-status">
      <strong
        >{vaultName
          ? connectedVaultLabel(vaultName)
          : translatePlain(I18N_KEYS.ExtensionCompanionNotConnected)}</strong
      ><span
        >{secretCountValue()} · {translatePlain(
          I18N_KEYS.ExtensionCompanionSecretsAvailable,
        )}</span
      >
    </section>
    <button data-testid="open-simple-vault-btn" onclick={openSimpleVault}
      >{translatePlain(I18N_KEYS.ExtensionSetupOpenSimpleVault)}</button
    >
    <button
      data-testid="connect-simple-vault-btn"
      class="secondary"
      disabled={busy || pairingCandidate.kind !== PairingCandidateKind.Selected}
      onclick={() => {
        if (pairingCandidate.kind === PairingCandidateKind.Selected)
          beginPairing(pairingCandidate.device)
      }}
      >{translatePlain(
        showExistingConnection
          ? I18N_KEYS.ExtensionCompanionPairAnotherVault
          : connectActionKey(),
      )}</button
    >
    <button
      data-testid="companion-done-btn"
      class="secondary"
      onclick={closeCompanion}>{translatePlain(I18N_KEYS.CommonDone)}</button
    >
  {:else if status === DeviceProtectionStatus.Pin || status === DeviceProtectionStatus.PinSetup}
    <label
      >{translatePlain(I18N_KEYS.DeviceProtectionPinLabel)}<input
        type="password"
        data-testid={status === DeviceProtectionStatus.PinSetup
          ? 'device-protection-pin-input'
          : 'device-protection-pin-unlock-input'}
        bind:value={pin}
        autocomplete="current-password"
      /></label
    >
    {#if status === DeviceProtectionStatus.PinSetup}<label
        >{translatePlain(I18N_KEYS.DeviceProtectionPinConfirmLabel)}<input
          type="password"
          data-testid="device-protection-pin-confirm"
          bind:value={pinConfirm}
          autocomplete="new-password"
        /></label
      >{/if}
    <button
      disabled={busy}
      data-testid={status === DeviceProtectionStatus.PinSetup
        ? 'device-protection-pin-setup-btn'
        : 'device-protection-pin-unlock-btn'}
      onclick={status === DeviceProtectionStatus.PinSetup
        ? createPin
        : unlockPin}
      >{translatePlain(
        status === DeviceProtectionStatus.PinSetup
          ? I18N_KEYS.DeviceProtectionPinSetupAction
          : I18N_KEYS.DeviceProtectionPinUnlockAction,
      )}</button
    >
  {:else if needsSetup}
    <p>{translatePlain(I18N_KEYS.DeviceProtectionSetupDescription)}</p>
    <button
      data-testid="device-protection-use-existing-choice"
      disabled={busy}
      onclick={useExistingPasskey}
      >{translatePlain(I18N_KEYS.DeviceProtectionExistingPasskeyAction)}</button
    >
    <label
      >{translatePlain(I18N_KEYS.DeviceProtectionPasskeyLabel)}<input
        data-testid="device-protection-passkey-label"
        bind:value={passkeyLabel}
      /></label
    >
    <label
      >{translatePlain(I18N_KEYS.DeviceProtectionModeGroupLabel)}<select
        data-testid="device-mode-select"
        bind:value={deviceMode}
        ><option value={DeviceMode.Standard}
          >{translatePlain(I18N_KEYS.DeviceProtectionModeStandardTitle)}</option
        ><option value={DeviceMode.AntiHacker}
          >{translatePlain(
            I18N_KEYS.DeviceProtectionModeAntiHackerTitle,
          )}</option
        ></select
      ></label
    >
    <button
      data-testid="device-protection-setup-btn"
      class="secondary"
      disabled={busy}
      onclick={createPasskey}
      >{translatePlain(I18N_KEYS.DeviceProtectionSetupAction)}</button
    >
  {:else}<p>{translatePlain(I18N_KEYS.DeviceProtectionUnlockDescription)}</p>
    <button
      data-testid="device-protection-unlock-btn"
      disabled={busy}
      onclick={unlockPasskey}
      >{translatePlain(I18N_KEYS.DeviceProtectionUnlockAction)}</button
    >{/if}
</main>
