<!--
The panel the Nook toolbar icon opens beside itself. It leads with Open
vault, shows the identities this browser is connected to, and keeps the
quick actions (unlock with a PIN, lock, connect) here. A passkey prompt
would close a toolbar panel, so passkey unlock, first setup and connecting
an identity hand off to the Nook tab, which owns those ceremonies.
-->
<script lang="ts">
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import {
    ArrowUpRight,
    Fingerprint,
    FolderOpen,
    Lock,
    Plus,
    Settings2,
  } from '@lucide/svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import {
    ExtensionTranslationRequestKind,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
    extensionLocaleCatalog,
  } from '../lib/i18n'
  import {
    DeviceProtectionStatus,
    ExtensionSessionDeviceStateKind,
    type ExtensionSessionDeviceState,
    type ExtensionSessionDeviceWire,
    extensionWasmRuntime,
  } from '../lib/nook-wasm'
  import {
    PairedVaultsLoadKind,
    pairedVaultGroups,
    pairedVaultsClient,
    type PairedVaultsLoad,
  } from '../lib/paired-vaults'
  import {
    ActionPanelState,
    actionPanelState,
    ActionPanelMessages,
  } from './action-panel-state'

  let {
    i18n,
    protectionStatus,
    activeSessionDevice,
  }: {
    i18n: ExtensionI18n
    protectionStatus: DeviceProtectionStatus
    activeSessionDevice: ExtensionSessionDeviceState
  } = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  function initialStatus(): DeviceProtectionStatus {
    return protectionStatus
  }
  function initialDevice(): ExtensionSessionDeviceState {
    return activeSessionDevice
  }

  let status = $state<DeviceProtectionStatus>(initialStatus())
  let device = $state<ExtensionSessionDeviceState>(initialDevice())
  let vaults = $state<PairedVaultsLoad>({
    kind: PairedVaultsLoadKind.Unavailable,
  })
  let pin = $state('')
  let busy = $state(false)
  let error = $state('')
  let checking = $state(false)
  let awaitingGrant = $state(0)

  const panelState = $derived(actionPanelState(status))
  const activeDeviceId = $derived(
    device.kind === ExtensionSessionDeviceStateKind.Active
      ? device.device.deviceId
      : '',
  )
  const groups = $derived(
    vaults.kind === PairedVaultsLoadKind.Ready
      ? pairedVaultGroups(vaults.vaults)
      : [],
  )
  const stateLabel = $derived.by((): I18nKey => {
    switch (panelState) {
      case ActionPanelState.Unlocked:
        return I18N_KEYS.ExtensionActionStateUnlocked
      case ActionPanelState.PinLocked:
      case ActionPanelState.PasskeyLocked:
        return I18N_KEYS.ExtensionActionStateLocked
      case ActionPanelState.Setup:
        return I18N_KEYS.ExtensionActionStateSetup
    }
  })

  async function loadVaults(): Promise<void> {
    vaults = await pairedVaultsClient.list()
  }

  $effect(() => {
    if (panelState === ActionPanelState.Unlocked) void loadVaults()
  })

  /** Opening a page closes the panel; a failure stays on it. */
  async function leaveFor(opened: Promise<boolean>): Promise<void> {
    busy = true
    error = ''
    const done = await opened
    busy = false
    if (done) window.close()
    else error = translatePlain(I18N_KEYS.ExtensionActionOpenFailed)
  }

  function openVault(): void {
    void leaveFor(ActionPanelMessages.openVault())
  }

  /** The Nook tab: passkey unlock, setup, and connecting identities. */
  function openTab(pair: boolean): void {
    void leaveFor(ActionPanelMessages.openTab(pair))
  }

  async function lock(): Promise<void> {
    busy = true
    error = ''
    const locked = await ActionPanelMessages.lock()
    if (!locked) {
      busy = false
      error = translatePlain(I18N_KEYS.ExtensionActionLockFailed)
      return
    }
    try {
      status = await extensionWasmRuntime.extensionDeviceProtectionStatus()
    } catch {
      error = translatePlain(I18N_KEYS.ExtensionActionLockFailed)
    }
    device = { kind: ExtensionSessionDeviceStateKind.Locked }
    busy = false
  }

  /** A PIN unlocks right here; then the identity's new vaults are paired. */
  async function unlockPin(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    busy = true
    error = ''
    let unlocked: ExtensionSessionDeviceWire
    try {
      unlocked = await extensionWasmRuntime.unlockExtensionPin(pin)
    } catch {
      busy = false
      error = translatePlain(I18N_KEYS.ExtensionActionUnlockFailed)
      return
    }
    pin = ''
    device = { kind: ExtensionSessionDeviceStateKind.Active, device: unlocked }
    status = DeviceProtectionStatus.Unlocked
    busy = false
    checking = true
    const refreshed = await pairedVaultsClient.refreshIdentity(
      unlocked.deviceId,
    )
    checking = false
    if (!refreshed.ok) {
      error = translatePlain(I18N_KEYS.ExtensionCompanionIdentitySyncFailed)
      return
    }
    awaitingGrant = refreshed.awaitingGrant
    if (refreshed.paired > 0) await loadVaults()
  }

  function awaitingNote(): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionCompanionIdentitySyncAwaiting,
      replacements: { count: String(awaitingGrant) },
    }
    return i18n.t(request)
  }
</script>

<main class="action-panel" data-testid="extension-action-panel">
  <header class="action-header">
    <NookIcon src="../icons/nook.png" alt="" class="action-logo" />
    <span class="action-title">Nook</span>
    <span
      class="action-state"
      data-state={panelState}
      data-testid="action-panel-state"
    >
      <span aria-hidden="true"></span>
      {translatePlain(stateLabel)}
    </span>
    {#if panelState === ActionPanelState.Unlocked}
      <button
        type="button"
        class="action-icon-button"
        disabled={busy}
        title={translatePlain(I18N_KEYS.ExtensionActionLock)}
        aria-label={translatePlain(I18N_KEYS.ExtensionActionLock)}
        data-testid="action-panel-lock"
        onclick={() => void lock()}
      >
        <Lock size={15} aria-hidden="true" />
      </button>
    {/if}
  </header>

  <button
    type="button"
    class="action-primary"
    disabled={busy}
    data-testid="action-panel-open-vault"
    onclick={openVault}
  >
    <span class="action-primary-icon" aria-hidden="true">
      <FolderOpen size={16} />
    </span>
    <span class="action-primary-copy">
      <span>{translatePlain(I18N_KEYS.ExtensionActionOpenVault)}</span>
      <small>{translatePlain(I18N_KEYS.ExtensionActionOpenVaultHint)}</small>
    </span>
    <ArrowUpRight size={15} aria-hidden="true" />
  </button>

  {#if panelState === ActionPanelState.Unlocked}
    <section class="action-section" data-testid="action-panel-identities">
      <p class="action-label">
        {translatePlain(I18N_KEYS.ExtensionActionIdentities)}
      </p>
      {#if checking}
        <p class="action-note" data-testid="action-panel-sync">
          {translatePlain(I18N_KEYS.ExtensionCompanionIdentitySyncChecking)}
        </p>
      {:else if awaitingGrant > 0}
        <p class="action-note" data-testid="action-panel-sync">
          {awaitingNote()}
        </p>
      {/if}
      {#if groups.length > 0}
        <ul class="action-identities">
          {#each groups as group (`${group.deviceId}:${group.identityLabel}`)}
            <li
              class="action-identity"
              class:is-other={group.deviceId !== activeDeviceId}
              data-testid="action-panel-identity"
            >
              <span class="action-identity-name">
                {group.identityLabel ||
                  translatePlain(I18N_KEYS.ExtensionCompanionOtherVaults)}
              </span>
              {#if group.deviceId !== activeDeviceId}
                <span class="action-tag">
                  {translatePlain(I18N_KEYS.ExtensionActionOtherIdentity)}
                </span>
              {/if}
              <span class="action-vaults">
                {#each group.vaults as vault (vault.vaultStoreId)}
                  <span class="action-vault" class:is-default={vault.isDefault}
                    >{vault.vaultName ||
                      translatePlain(I18N_KEYS.LoginVaultPickerUnnamed)}</span
                  >
                {/each}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="action-note">
          {translatePlain(I18N_KEYS.ExtensionActionNoIdentity)}
        </p>
      {/if}
      <button
        type="button"
        class="action-secondary"
        disabled={busy}
        data-testid="action-panel-connect"
        onclick={() => openTab(true)}
      >
        <Plus size={14} aria-hidden="true" />
        {translatePlain(
          groups.length > 0
            ? I18N_KEYS.ExtensionActionConnectAnother
            : I18N_KEYS.ExtensionActionConnectIdentity,
        )}
      </button>
    </section>
  {:else if panelState === ActionPanelState.PinLocked}
    <form class="action-section" onsubmit={(event) => void unlockPin(event)}>
      <label class="action-label" for="action-panel-pin">
        {translatePlain(I18N_KEYS.ExtensionActionPinLabel)}
      </label>
      <div class="action-pin-row">
        <input
          id="action-panel-pin"
          type="password"
          inputmode="numeric"
          autocomplete="current-password"
          bind:value={pin}
          disabled={busy}
          data-testid="action-panel-pin"
        />
        <button
          type="submit"
          class="action-secondary"
          disabled={busy || pin.length === 0}
          data-testid="action-panel-pin-unlock"
        >
          {translatePlain(I18N_KEYS.ExtensionActionUnlock)}
        </button>
      </div>
    </form>
  {:else if panelState === ActionPanelState.PasskeyLocked}
    <section class="action-section">
      <button
        type="button"
        class="action-secondary"
        disabled={busy}
        data-testid="action-panel-unlock"
        onclick={() => openTab(false)}
      >
        <Fingerprint size={14} aria-hidden="true" />
        {translatePlain(I18N_KEYS.ExtensionActionUnlock)}
      </button>
      <p class="action-note">
        {translatePlain(I18N_KEYS.ExtensionActionUnlockPasskeyHint)}
      </p>
    </section>
  {:else}
    <section class="action-section">
      <button
        type="button"
        class="action-secondary"
        disabled={busy}
        data-testid="action-panel-setup"
        onclick={() => openTab(false)}
      >
        {translatePlain(I18N_KEYS.ExtensionActionSetUp)}
      </button>
      <p class="action-note">
        {translatePlain(I18N_KEYS.ExtensionActionSetUpHint)}
      </p>
    </section>
  {/if}

  {#if error}
    <p class="action-error" role="alert" data-testid="action-panel-error">
      {error}
    </p>
  {/if}

  <footer class="action-footer">
    <button
      type="button"
      class="action-link"
      disabled={busy}
      data-testid="action-panel-manage"
      onclick={() => openTab(false)}
    >
      <Settings2 size={13} aria-hidden="true" />
      {translatePlain(I18N_KEYS.ExtensionActionManage)}
    </button>
  </footer>
</main>
