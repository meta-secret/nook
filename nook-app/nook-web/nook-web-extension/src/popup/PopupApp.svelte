<script lang="ts">
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { ArrowUpRight, Check, FolderKey, Plus } from '@lucide/svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import {
    ExtensionTranslationRequestKind,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
    extensionLocaleCatalog,
  } from '../lib/i18n'
  import { OpenCompanionLauncherIntent } from '../../../nook-web-shared/src/extension/companion-launcher-message'
  import {
    DeviceProtectionStatus,
    ExtensionSessionDeviceStateKind,
    type NookIdentityConnectionStart,
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
    DeviceActionFollowUp,
    IdentitySyncKind,
    type IdentitySync,
  } from './popup-app-state'
  import ExtensionDeviceProtection from './ExtensionDeviceProtection.svelte'
  import ConnectChain from './ConnectChain.svelte'
  import {
    DeviceProtectionPhase,
    DeviceProtectionPurposeKind,
    DeviceProtectionStageMap,
    IdentityKeyCancelOutcome,
    type DeviceProtectionPurpose,
    type DeviceProtectionUnlock,
  } from './device-protection-ceremony'
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
  let pairingCandidate = $state<PairingCandidate>({
    kind: PairingCandidateKind.NotSelected,
  })
  let vaults = $state<PairedVaultsLoad>({
    kind: PairedVaultsLoadKind.Unavailable,
  })
  /** Item counts per paired vault, filled in as each summary arrives. */
  let counts = $state<Record<string, CompanionSecretCount>>({})
  /** Connecting another identity: its own key (passkey or PIN) comes first. */
  let purpose = $state<DeviceProtectionPurpose>({
    kind: DeviceProtectionPurposeKind.ExtensionKey,
  })
  let identitySync = $state<IdentitySync>({ kind: IdentitySyncKind.Idle })

  const showToolbarMenu = $derived(
    status === DeviceProtectionStatus.Unlocked &&
      purpose.kind === DeviceProtectionPurposeKind.ExtensionKey,
  )
  const stage = $derived(DeviceProtectionStageMap.from(status))
  /** The app key of the unlocked identity. */
  const activeDeviceId = $derived(
    pairingCandidate.kind === PairingCandidateKind.Selected
      ? pairingCandidate.device.deviceId
      : '',
  )
  /** First use: the key is being set up; vaults connect in step 2. */
  const phase = $derived(DeviceProtectionStageMap.phase(stage))

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
  /** Opens the connect route in the one Nook tab of this tab's window; the
   * tab id in the reply is not needed here, as this tab then closes. */
  async function beginPairing(
    device: ExtensionSessionDeviceWire,
  ): Promise<void> {
    busy = true
    error = ''
    let windowId: number
    try {
      const current = await chrome.windows.getCurrent()
      if (typeof current.id !== 'number') throw new Error('no window id')
      windowId = current.id
    } catch {
      busy = false
      error = translatePlain(I18N_KEYS.ExtensionConnectStartFailed)
      return
    }
    const message: {
      type: string
      payload: ExtensionSessionDeviceWire & {
        deviceLabel: string
        windowId: number
        connectId: string
      }
    } = {
      type: 'nook:begin-extension-pairing',
      payload: {
        ...device,
        deviceLabel: translatePlain(I18N_KEYS.ExtensionSetupProfileTitle),
        windowId,
        // No side panel follows a connect the popup starts: its id matches
        // no panel's.
        connectId: crypto.randomUUID(),
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

  /** The extension just unlocked: pair the vaults its identity gained since
   * it joined. A refresh that fails says so. */
  async function refreshIdentity(
    device: ExtensionSessionDeviceWire,
  ): Promise<void> {
    identitySync = { kind: IdentitySyncKind.Checking }
    const refreshed = await pairedVaultsClient.refreshIdentity(device.deviceId)
    if (!refreshed.ok) {
      identitySync = { kind: IdentitySyncKind.Idle }
      error = translatePlain(I18N_KEYS.ExtensionCompanionIdentitySyncFailed)
      return
    }
    identitySync = {
      kind: IdentitySyncKind.Checked,
      awaitingGrant: refreshed.awaitingGrant,
    }
    if (refreshed.paired > 0) await loadVaults(device)
  }

  function awaitingGrantNote(awaitingGrant: number): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionCompanionIdentitySyncAwaiting,
      replacements: { count: String(awaitingGrant) },
    }
    return i18n.t(request)
  }

  /** Rust decides whether this key connects the next identity or a new key
   * is set up for it first, as each identity on the web app has its own. */
  async function connectIdentity(
    device: ExtensionSessionDeviceWire,
  ): Promise<void> {
    busy = true
    error = ''
    let start: NookIdentityConnectionStart
    try {
      start = await extensionWasmRuntime.beginIdentityConnection(
        translatePlain(I18N_KEYS.ExtensionSetupProfileTitle),
      )
    } catch {
      busy = false
      error = translatePlain(I18N_KEYS.ExtensionCompanionConnectIdentityFailed)
      return
    }
    if (start === 'current-key') {
      void beginPairing(device)
      return
    }
    busy = false
    purpose = {
      kind: DeviceProtectionPurposeKind.IdentityKey,
      cancel: cancelIdentityKey,
    }
    status = DeviceProtectionStatus.Missing
  }

  /** The person did not set up the next identity's key: drop it. */
  async function cancelIdentityKey(): Promise<IdentityKeyCancelOutcome> {
    try {
      await extensionWasmRuntime.cancelIdentityConnection()
    } catch {
      return IdentityKeyCancelOutcome.Failed
    }
    purpose = { kind: DeviceProtectionPurposeKind.ExtensionKey }
    status = DeviceProtectionStatus.Unlocked
    return IdentityKeyCancelOutcome.Cancelled
  }

  /** Switch to another identity of this extension; it unlocks with its key. */
  async function useIdentity(deviceId: string): Promise<void> {
    busy = true
    error = ''
    try {
      await extensionWasmRuntime.activateIdentity(deviceId)
      status = await extensionWasmRuntime.extensionDeviceProtectionStatus()
    } catch {
      error = translatePlain(I18N_KEYS.ExtensionCompanionUseIdentityFailed)
    } finally {
      busy = false
    }
    identitySync = { kind: IdentitySyncKind.Idle }
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

  /** The ceremony set up or unlocked a key: show the vaults, or connect
   * the key just made for the next identity. */
  function deviceUnlocked(unlock: DeviceProtectionUnlock): void {
    const { device, followUp } = unlock
    enterToolbarMenu(device)
    switch (purpose.kind) {
      case DeviceProtectionPurposeKind.IdentityKey:
        purpose = { kind: DeviceProtectionPurposeKind.ExtensionKey }
        void beginPairing(device)
        return
      case DeviceProtectionPurposeKind.ExtensionKey:
        break
    }
    switch (followUp) {
      case DeviceActionFollowUp.RefreshIdentity:
        void refreshIdentity(device)
        return
      case DeviceActionFollowUp.Menu:
        return
    }
  }

  function changeStatus(next: DeviceProtectionStatus): void {
    status = next
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
      {#if identitySync.kind === IdentitySyncKind.Checking}
        <p class="companion-description" data-testid="identity-sync-status">
          {translatePlain(I18N_KEYS.ExtensionCompanionIdentitySyncChecking)}
        </p>
      {:else if identitySync.kind === IdentitySyncKind.Checked && identitySync.awaitingGrant > 0}
        <p class="companion-description" data-testid="identity-sync-status">
          {awaitingGrantNote(identitySync.awaitingGrant)}
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
        {#each groups as group (`${group.deviceId}:${group.identityLabel}`)}
          <div class="vault-group" data-testid="companion-vault-group">
            <div class="vault-group-heading">
              <p class="vault-group-label">
                {group.identityLabel ||
                  translatePlain(I18N_KEYS.ExtensionCompanionOtherVaults)}
              </p>
              {#if activeDeviceId && group.deviceId !== activeDeviceId}
                <button
                  type="button"
                  class="menu-secondary-action"
                  disabled={busy}
                  data-testid="companion-use-identity"
                  onclick={() => void useIdentity(group.deviceId)}
                >
                  {translatePlain(I18N_KEYS.ExtensionCompanionUseIdentity)}
                </button>
              {/if}
            </div>
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
            void connectIdentity(pairingCandidate.device)
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
    {#if phase === DeviceProtectionPhase.Setup}
      <p class="step-label">
        {translatePlain(I18N_KEYS.ExtensionDeviceSetupStepLabel)}
      </p>
    {/if}
    <ConnectChain {i18n} {status} />
    <ExtensionDeviceProtection
      {i18n}
      {status}
      {purpose}
      onstatus={changeStatus}
      onunlocked={deviceUnlocked}
    />
  </main>
{/if}
