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
    ArrowUpRight,
    Asterisk,
    Check,
    Fingerprint,
    FolderKey,
    KeyRound,
    Plus,
    Puzzle,
  } from '@lucide/svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
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
  import { DeviceProtectionSetupWorkflow } from '../../../nook-web-shared/src/vault-app/lib/components/device-protection-gate-state'
  import {
    PairedVaultsLoadKind,
    pairedVaultGroups,
    pairedVaultsClient,
    type PairedVaultsLoad,
    type PairedVaultSummary,
  } from '../lib/paired-vaults'

  let {
    i18n,
    launcherIntent,
    protectionStatus,
    activeSessionDevice,
  }: {
    i18n: ExtensionI18n
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
  let setupWorkflow = $state(DeviceProtectionSetupWorkflow.Authenticate)
  let pin = $state('')
  let pinConfirm = $state('')
  let pairingCandidate = $state<PairingCandidate>({
    kind: PairingCandidateKind.NotSelected,
  })
  let vaults = $state<PairedVaultsLoad>({
    kind: PairedVaultsLoadKind.Unavailable,
  })
  /** Item counts per paired vault, filled in as each summary arrives. */
  let counts = $state<Record<string, CompanionSecretCount>>({})

  const needsSetup = $derived(
    status === DeviceProtectionStatus.Missing ||
      status === DeviceProtectionStatus.Plaintext,
  )
  const showToolbarMenu = $derived(status === DeviceProtectionStatus.Unlocked)
  /** The extension's key is a PIN rather than a passkey. */
  const usesPin = $derived(
    status === DeviceProtectionStatus.Pin ||
      status === DeviceProtectionStatus.PinSetup,
  )
  /** First use: the key is being set up; vaults connect in step 2. */
  const inSetup = $derived(
    needsSetup || status === DeviceProtectionStatus.PinSetup,
  )
  const setupTitleKey = $derived.by((): I18nKey => {
    if (status === DeviceProtectionStatus.PinSetup)
      return I18N_KEYS.ExtensionDeviceSetupPinSetupTitle
    if (!needsSetup) return I18N_KEYS.ExtensionDeviceSetupUnlockTitle
    return setupWorkflow === DeviceProtectionSetupWorkflow.Authenticate
      ? I18N_KEYS.ExtensionDeviceSetupSetupTitle
      : I18N_KEYS.ExtensionDeviceSetupCreateTitle
  })
  const setupDescriptionKey = $derived.by((): I18nKey => {
    if (status === DeviceProtectionStatus.PinSetup)
      return I18N_KEYS.ExtensionDeviceSetupPinSetupDescription
    if (status === DeviceProtectionStatus.Pin)
      return I18N_KEYS.ExtensionDeviceSetupPinUnlockDescription
    if (!needsSetup) return I18N_KEYS.ExtensionDeviceSetupUnlockDescription
    return setupWorkflow === DeviceProtectionSetupWorkflow.Authenticate
      ? I18N_KEYS.ExtensionDeviceSetupSetupDescription
      : I18N_KEYS.ExtensionDeviceSetupCreateDescription
  })

  const groups = $derived(
    vaults.kind === PairedVaultsLoadKind.Ready
      ? pairedVaultGroups(vaults.vaults)
      : [],
  )

  function itemCount(vaultStoreId: string): string {
    const count = counts[vaultStoreId]
    if (!count || count.kind !== CompanionSecretCountKind.Available) return ''
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionCompanionItemCount,
      replacements: { count: String(count.count) },
    }
    return i18n.t(request)
  }

  type VaultCountRequest = {
    readonly vault: PairedVaultSummary
    readonly device: ExtensionSessionDeviceWire
  }

  async function loadCount(request: VaultCountRequest): Promise<void> {
    const { vault, device } = request
    counts[vault.vaultStoreId] = { kind: CompanionSecretCountKind.Loading }
    try {
      const summaryArgs: CompanionVaultSummaryArgs = {
        vaultStoreId: vault.vaultStoreId,
        appId: device.deviceId,
        appPublicKey: device.devicePublicKey,
        appSigningPublicKey: device.deviceSigningPublicKey,
      }
      const summary =
        await extensionWasmRuntime.extensionVaultSummary(summaryArgs)
      counts[vault.vaultStoreId] = {
        kind: CompanionSecretCountKind.Available,
        count: summary.secretCount,
      }
    } catch {
      counts[vault.vaultStoreId] = {
        kind: CompanionSecretCountKind.Unavailable,
      }
    }
  }

  async function loadVaults(device: ExtensionSessionDeviceWire): Promise<void> {
    vaults = await pairedVaultsClient.list()
    if (vaults.kind !== PairedVaultsLoadKind.Ready) return
    for (const vault of vaults.vaults) {
      const countRequest: VaultCountRequest = { vault, device }
      void loadCount(countRequest)
    }
  }

  async function makeDefault(vaultStoreId: string): Promise<void> {
    busy = true
    error = ''
    const changed = await pairedVaultsClient.makeDefault(vaultStoreId)
    busy = false
    if (!changed) {
      error = translatePlain(I18N_KEYS.ExtensionCompanionMakeDefaultFailed)
      return
    }
    vaults = await pairedVaultsClient.list()
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
    void loadVaults(device)
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
            class="companion-state connected"
            data-testid="companion-session-status"
          >
            <span aria-hidden="true"></span>
            {translatePlain(I18N_KEYS.ExtensionCompanionUnlocked)}
          </div>
        </div>
      </div>
      {#if launcherIntent === OpenCompanionLauncherIntent.PilotAuth}
        <p class="companion-description" data-testid="companion-description">
          {translatePlain(I18N_KEYS.ExtensionCompanionPilotReturnGuidance)}
        </p>
      {/if}
    </header>

    {#if vaults.kind === PairedVaultsLoadKind.Ready && vaults.vaults.length > 0}
      <section
        class="vault-list-section"
        aria-labelledby="companion-vaults-title"
        data-testid="companion-vaults"
      >
        <div class="vault-list-heading">
          <h1 id="companion-vaults-title">
            {translatePlain(I18N_KEYS.ExtensionCompanionVaultsTitle)}
          </h1>
          <p class="companion-description">
            {translatePlain(I18N_KEYS.ExtensionCompanionVaultsHint)}
          </p>
        </div>
        {#each groups as group (group.identityLabel)}
          <div class="vault-group" data-testid="companion-vault-group">
            <p class="vault-group-label">
              {group.identityLabel ||
                translatePlain(I18N_KEYS.ExtensionCompanionOtherVaults)}
            </p>
            <ul class="vault-list">
              {#each group.vaults as vault (vault.vaultStoreId)}
                <li
                  class="vault-row"
                  class:is-default={vault.isDefault}
                  data-testid="companion-vault"
                  data-vault-store-id={vault.vaultStoreId}
                  data-default={vault.isDefault}
                >
                  <span class="vault-icon" aria-hidden="true">
                    <FolderKey size={14} />
                  </span>
                  <div class="vault-row-main">
                    <span class="vault-row-name"
                      >{vault.vaultName ||
                        translatePlain(I18N_KEYS.LoginVaultPickerUnnamed)}</span
                    >
                    <span class="vault-row-meta">
                      {#if vault.fillsPasswords}
                        <span
                          >{translatePlain(
                            I18N_KEYS.ExtensionCompanionFillsPasswords,
                          )}</span
                        >
                      {/if}
                      {#if vault.managesPasskeys}
                        <span
                          >{translatePlain(
                            I18N_KEYS.ExtensionCompanionManagesPasskeys,
                          )}</span
                        >
                      {/if}
                      {#if itemCount(vault.vaultStoreId)}
                        <span data-testid="companion-vault-count"
                          >{itemCount(vault.vaultStoreId)}</span
                        >
                      {/if}
                    </span>
                  </div>
                  {#if vault.isDefault}
                    <span
                      class="vault-default-tag"
                      title={translatePlain(
                        I18N_KEYS.ExtensionCompanionDefaultVaultHint,
                      )}
                      data-testid="companion-default-vault"
                    >
                      <Check size={12} aria-hidden="true" />
                      {translatePlain(I18N_KEYS.ExtensionCompanionDefaultVault)}
                    </span>
                  {:else}
                    <button
                      type="button"
                      class="menu-secondary-action vault-make-default"
                      disabled={busy}
                      title={translatePlain(
                        I18N_KEYS.ExtensionCompanionDefaultVaultHint,
                      )}
                      data-testid="companion-make-default"
                      onclick={() => void makeDefault(vault.vaultStoreId)}
                    >
                      {translatePlain(I18N_KEYS.ExtensionCompanionMakeDefault)}
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </section>
    {:else}
      <section class="vault-empty" data-testid="companion-no-vaults">
        <h1>{translatePlain(I18N_KEYS.ExtensionCompanionNoVaultsTitle)}</h1>
        <p class="companion-description">
          {translatePlain(I18N_KEYS.ExtensionCompanionNoVaultsBody)}
        </p>
      </section>
    {/if}

    <div class="companion-actions">
      <button
        type="button"
        class:secondary-button={vaults.kind === PairedVaultsLoadKind.Ready &&
          vaults.vaults.length > 0 &&
          launcherIntent !== OpenCompanionLauncherIntent.Pair}
        disabled={busy ||
          pairingCandidate.kind !== PairingCandidateKind.Selected}
        data-testid="connect-simple-vault-btn"
        onclick={() => {
          if (pairingCandidate.kind === PairingCandidateKind.Selected)
            beginPairing(pairingCandidate.device)
        }}
      >
        <Plus size={14} aria-hidden="true" />
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : vaults.kind === PairedVaultsLoadKind.Ready &&
              vaults.vaults.length > 0
            ? translatePlain(I18N_KEYS.ExtensionCompanionConnectAnother)
            : translatePlain(I18N_KEYS.ExtensionCompanionConnectVault)}
      </button>
      <button
        type="button"
        class="secondary-button"
        data-testid="open-simple-vault-btn"
        onclick={openSimpleVault}
      >
        {translatePlain(I18N_KEYS.ExtensionCompanionOpenNook)}
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>
    </div>
    {#if error}
      <p class="error-message" role="alert">{error}</p>
    {/if}
  </main>
{:else}
  <main class="device-setup" data-testid="extension-device-setup">
    {#if inSetup}
      <p class="step-label">
        {translatePlain(I18N_KEYS.ExtensionDeviceSetupStepLabel)}
      </p>
    {/if}
    <!-- What connects to what: the key (passkey or PIN) opens this
         extension now; the vaults connect to it in step 2. -->
    <div
      class="connect-chain"
      role="img"
      aria-label={translatePlain(
        usesPin
          ? I18N_KEYS.ExtensionDeviceSetupChainPin
          : I18N_KEYS.ExtensionDeviceSetupChainPasskey,
      )}
      data-testid="device-setup-chain"
      data-key={usesPin ? 'pin' : 'passkey'}
    >
      <div class="chain-node is-on" aria-hidden="true">
        <span class="chain-icon">
          {#if usesPin}
            <Asterisk size={18} />
          {:else}
            <Fingerprint size={18} />
          {/if}
        </span>
        <span class="chain-label">
          {translatePlain(
            usesPin
              ? I18N_KEYS.ExtensionDeviceSetupNodePin
              : I18N_KEYS.ExtensionDeviceSetupNodePasskey,
          )}
        </span>
      </div>
      <span class="chain-link is-on" aria-hidden="true"></span>
      <div class="chain-node is-on" aria-hidden="true">
        <span class="chain-icon"><Puzzle size={18} /></span>
        <span class="chain-label">
          {translatePlain(I18N_KEYS.ExtensionDeviceSetupNodeExtension)}
        </span>
      </div>
      <span class="chain-link" aria-hidden="true"></span>
      <div class="chain-node" aria-hidden="true">
        <span class="chain-icon"><FolderKey size={18} /></span>
        <span class="chain-label">
          {translatePlain(I18N_KEYS.ExtensionDeviceSetupNodeVaults)}
        </span>
        {#if inSetup}
          <span class="chain-tag">
            {translatePlain(I18N_KEYS.ExtensionDeviceSetupNodeNext)}
          </span>
        {/if}
      </div>
    </div>
    <h1>{translatePlain(setupTitleKey)}</h1>
    <p class="description">{translatePlain(setupDescriptionKey)}</p>

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
      <button
        type="button"
        disabled={busy}
        data-testid="device-protection-use-existing-choice"
        onclick={useExistingPasskey}
      >
        <Fingerprint size={16} aria-hidden="true" />
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : translatePlain(I18N_KEYS.ExtensionDeviceSetupUsePasskey)}
      </button>
      <p class="alternative-line">
        {translatePlain(I18N_KEYS.ExtensionDeviceSetupNoPasskey)}
        <button
          type="button"
          class="link-button"
          disabled={busy}
          data-testid="device-protection-create-new-choice"
          onclick={() => {
            setupWorkflow = DeviceProtectionSetupWorkflow.Create
            error = ''
          }}
        >
          {translatePlain(I18N_KEYS.ExtensionDeviceSetupCreateOne)}
        </button>
      </p>
    {:else if needsSetup}
      <button
        type="button"
        disabled={busy}
        data-testid="device-protection-setup-btn"
        onclick={createPasskey}
      >
        <KeyRound size={16} aria-hidden="true" />
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : translatePlain(I18N_KEYS.ExtensionDeviceSetupCreateAction)}
      </button>
      <details class="setup-options">
        <summary
          >{translatePlain(I18N_KEYS.ExtensionDeviceSetupOptions)}</summary
        >
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
      </details>
      <p class="alternative-line">
        {translatePlain(I18N_KEYS.ExtensionDeviceSetupHavePasskey)}
        <button
          type="button"
          class="link-button"
          disabled={busy}
          data-testid="device-protection-use-existing-choice"
          onclick={useExistingPasskey}
        >
          {translatePlain(I18N_KEYS.ExtensionDeviceSetupUseExisting)}
        </button>
      </p>
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
        <Fingerprint size={16} aria-hidden="true" />
        {busy
          ? translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
          : translatePlain(I18N_KEYS.ExtensionDeviceSetupUnlockAction)}
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
