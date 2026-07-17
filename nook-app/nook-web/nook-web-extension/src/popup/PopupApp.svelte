<script lang="ts">
  import { KeyRound, ShieldCheck } from '@lucide/svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import type { ExtensionI18n } from '../lib/i18n'
  import {
    createExtensionPasskey,
    createExtensionPin,
    recoverExtensionPasskey,
    unlockExtensionPasskey,
    unlockExtensionPin,
    type ExtensionDeviceMode,
    type ExtensionDeviceProtectionResult,
    type ExtensionDeviceProtectionStatus,
  } from '../lib/nook-wasm'

  type PopupProtectionStatus = ExtensionDeviceProtectionStatus | 'pin-setup'

  let {
    i18n,
    isConnected,
    protectionStatus,
    activeSessionDevice,
  }: {
    i18n: ExtensionI18n
    isConnected: boolean
    protectionStatus: ExtensionDeviceProtectionStatus
    activeSessionDevice?: ExtensionDeviceProtectionResult
  } = $props()

  function initialProtectionStatus(): PopupProtectionStatus {
    return protectionStatus
  }

  let status = $state<PopupProtectionStatus>(initialProtectionStatus())
  let busy = $state(false)
  let error = $state('')
  let passkeyLabel = $state('')
  let deviceMode = $state<ExtensionDeviceMode>('standard')
  let pin = $state('')
  let pinConfirm = $state('')
  let pendingDevice = $state<ExtensionDeviceProtectionResult | undefined>()

  const needsSetup = $derived(status === 'missing' || status === 'plaintext')
  const showCompanionHome = $derived(status === 'unlocked')

  function errorMessage(caught: unknown, fallbackKey: string): string {
    if (!(caught instanceof Error)) return i18n.t(fallbackKey)
    if (caught.message.includes('PASSKEY_CEREMONY_NOT_ALLOWED')) {
      return i18n.t(fallbackKey)
    }
    return caught.message
  }

  function openSimpleVault(): void {
    error = ''
    chrome.runtime.sendMessage(
      { type: 'nook:open-simple-vault' },
      (response: { ok?: boolean } | undefined) => {
        if (chrome.runtime.lastError || response?.ok !== true) {
          error = i18n.t('extension.connect.start_failed')
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
          deviceLabel: i18n.t('extension.setup.profile_title'),
        },
      },
      (response: { ok?: boolean } | undefined) => {
        busy = false
        if (chrome.runtime.lastError || response?.ok !== true) {
          error = i18n.t('extension.connect.start_failed')
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
    pendingDevice = device
    status = 'unlocked'
    busy = false
    error = ''
  }

  $effect(() => {
    if (!activeSessionDevice) return
    enterCompanionHome(activeSessionDevice)
  })

  async function runDeviceAction(
    action: () => Promise<ExtensionDeviceProtectionResult>,
    fallbackKey = 'extension.setup.passkey_setup_failed',
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
        status = 'pin-setup'
        error = i18n.t(
          caught.message.includes('PASSKEY_UNAVAILABLE')
            ? 'device_protection.passkey_unavailable_pin_fallback_ready'
            : 'device_protection.pin_fallback_ready',
        )
        return
      }
      error = errorMessage(caught, fallbackKey)
    }
  }

  function createPasskey(): void {
    void runDeviceAction(
      () => createExtensionPasskey(passkeyLabel, deviceMode),
      'device_protection.passkey_create_not_allowed',
    )
  }

  function useExistingPasskey(): void {
    void runDeviceAction(
      recoverExtensionPasskey,
      'device_protection.passkey_recovery_not_allowed',
    )
  }

  function unlockPasskey(): void {
    void runDeviceAction(
      unlockExtensionPasskey,
      'device_protection.passkey_unlock_not_allowed',
    )
  }

  function createPin(): void {
    if (pin !== pinConfirm) {
      error = i18n.t('device_protection.pin_mismatch')
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
    <p class="step-label">{i18n.t('extension.companion.step_label')}</p>
    <NookIcon src="../icons/nook.png" alt="" class="popup-logo" />
    <div class="shield-icon" aria-hidden="true">
      <ShieldCheck size={26} />
    </div>
    <h1>
      {i18n.t(
        isConnected
          ? 'extension.companion.ready_title'
          : 'extension.companion.connect_title',
      )}
    </h1>
    <p class="description">
      {i18n.t(
        isConnected
          ? 'extension.companion.ready_description'
          : 'extension.companion.connect_description',
      )}
    </p>

    {#if isConnected}
      <button
        type="button"
        data-testid="stay-as-companion-btn"
        onclick={stayAsCompanion}
      >
        {i18n.t('extension.companion.stay_ready')}
      </button>
    {:else if pendingDevice}
      <button
        type="button"
        disabled={busy}
        data-testid="connect-simple-vault-btn"
        onclick={() => {
          if (pendingDevice) beginPairing(pendingDevice)
        }}
      >
        {busy
          ? i18n.t('device_protection.authorizing')
          : i18n.t('extension.setup.connect_simple_vault')}
      </button>
    {/if}

    <button
      type="button"
      class="secondary-button"
      data-testid="open-simple-vault-btn"
      onclick={openSimpleVault}
    >
      {i18n.t('extension.setup.open_simple_vault')}
    </button>

    {#if !isConnected}
      <button
        type="button"
        class="secondary-button"
        data-testid="stay-as-companion-btn"
        onclick={stayAsCompanion}
      >
        {i18n.t('extension.companion.not_now')}
      </button>
    {/if}

    {#if error}
      <p class="error-message" role="alert">{error}</p>
    {/if}
  </main>
{:else}
  <main class="device-setup" data-testid="extension-device-setup">
    <p class="step-label">{i18n.t('device_protection.step_label')}</p>
    <div class="shield-icon" aria-hidden="true">
      {#if needsSetup || status === 'pin-setup'}
        <ShieldCheck size={26} />
      {:else}
        <KeyRound size={25} />
      {/if}
    </div>
    <h1>{i18n.t('device_protection.title')}</h1>
    <p class="description">
      {i18n.t(
        status === 'passkey' || status === 'unlocked'
          ? 'device_protection.unlock_description'
          : status === 'pin'
            ? 'device_protection.pin_unlock_description'
            : status === 'pin-setup'
              ? 'device_protection.pin_setup_description'
              : 'device_protection.setup_description',
      )}
    </p>

    {#if status === 'pin-setup'}
      <div class="field-group">
        <label for="device-protection-pin">
          {i18n.t('device_protection.pin_label')}
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
          {i18n.t('device_protection.pin_confirm_label')}
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
        {i18n.t('device_protection.pin_security_note')}
      </p>
      <button
        type="button"
        disabled={busy}
        data-testid="device-protection-pin-setup-btn"
        onclick={createPin}
      >
        {busy
          ? i18n.t('device_protection.authorizing')
          : i18n.t('device_protection.pin_setup_action')}
      </button>
    {:else if needsSetup}
      <div class="field-group">
        <label for="device-protection-mode">
          {i18n.t('device_protection.mode_group_label')}
        </label>
        <select
          id="device-protection-mode"
          bind:value={deviceMode}
          disabled={busy}
          data-testid="device-mode-select"
        >
          <option value="standard">
            {i18n.t('device_protection.mode_standard_title')}
          </option>
          <option value="anti-hacker">
            {i18n.t('device_protection.mode_anti_hacker_title')}
          </option>
        </select>
        <p class="field-hint">
          {i18n.t(
            deviceMode === 'standard'
              ? 'device_protection.mode_standard_description'
              : 'device_protection.mode_anti_hacker_description',
          )}
        </p>
      </div>

      <div class="field-group">
        <label for="device-protection-label">
          {i18n.t('device_protection.passkey_label')}
        </label>
        <input
          id="device-protection-label"
          type="text"
          autocomplete="off"
          placeholder={i18n.t('device_protection.passkey_label_placeholder')}
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
          ? i18n.t('device_protection.authorizing')
          : i18n.t('device_protection.setup_action')}
      </button>

      <div class="divider">
        <span></span>
        <small>{i18n.t('device_protection.existing_passkey_alternative')}</small
        >
        <span></span>
      </div>
      <button
        type="button"
        class="secondary-button"
        disabled={busy}
        data-testid="device-protection-use-existing-choice"
        onclick={useExistingPasskey}
      >
        {i18n.t('device_protection.existing_passkey_alternative_action')}
      </button>
    {:else if status === 'pin'}
      <div class="field-group">
        <label for="device-protection-pin">
          {i18n.t('device_protection.pin_label')}
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
          ? i18n.t('device_protection.authorizing')
          : i18n.t('device_protection.pin_unlock_action')}
      </button>
    {:else}
      <button
        type="button"
        disabled={busy}
        data-testid="device-protection-unlock-btn"
        onclick={unlockPasskey}
      >
        {busy
          ? i18n.t('device_protection.authorizing')
          : i18n.t('device_protection.unlock_action')}
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
