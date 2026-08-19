<!--
Evidence for the first link of the chain: the passkey, PIN, or companion
session a person actually presents. Shows one fingerprint, keeps the
user-supplied provider reminder editable, and hides raw WebAuthn observations
behind one disclosure.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Check, RefreshCw } from '@lucide/svelte'
  import {
    DeviceAccessProtectionKind,
    PasskeyKeeperKind,
    type NookPasskeyAttachmentState,
    type NookPasskeyBackupState,
    type PasskeyObservedBrowser,
    type PasskeyObservedPlatform,
    type PasskeyTransport,
  } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    type DashboardText,
    DashboardTextKind,
    type DashboardTimestamp,
    DashboardTimestampKind,
    ProviderSaveKind,
  } from '../devices-access-dashboard-state'
  import {
    formatAccessDate,
    isPasskeyProtection,
    knownText,
    lastUsedLabel,
    textValue,
  } from './access-chain'
  import {
    attachmentLabel,
    backupLabel,
    clientEnvironmentLabel,
    keeperLabel,
    keeperStorageNote,
    transportsLabel,
  } from './passkey-evidence-labels'

  let {
    vault,
    protection,
    passkeyName,
    credentialId,
    userHandleId,
    providerLabel,
    createdAt,
    lastUsedAt,
    attachment,
    transports,
    backupState,
    aaguid,
    keeper,
    observedBrowser,
    observedPlatform,
    providerDraft = $bindable(''),
    providerSaveState,
    onSaveProviderLabel,
    onProviderDraftInput,
  }: {
    vault: VaultState
    protection: DeviceAccessProtectionKind
    passkeyName: DashboardText
    credentialId: DashboardText
    userHandleId: DashboardText
    providerLabel: DashboardText
    createdAt: DashboardTimestamp
    lastUsedAt: DashboardTimestamp
    attachment: NookPasskeyAttachmentState
    transports: PasskeyTransport[]
    backupState: NookPasskeyBackupState
    aaguid: DashboardText
    keeper: PasskeyKeeperKind
    observedBrowser: PasskeyObservedBrowser
    observedPlatform: PasskeyObservedPlatform
    providerDraft: string
    providerSaveState: ProviderSaveKind
    onSaveProviderLabel: () => void
    onProviderDraftInput: () => void
  } = $props()

  const unknown = $derived(vault.t(I18N_KEYS.DevicesAccessUnknown))
  const recoveryNote = $derived(
    protection === DeviceAccessProtectionKind.PinOrPassphrase
      ? vault.t(I18N_KEYS.DeviceProtectionPinRecoveryWarning)
      : vault.t(I18N_KEYS.DeviceProtectionRecoveryWarning),
  )
  const saveDisabled = $derived(
    providerSaveState === ProviderSaveKind.Saving ||
      credentialId.kind !== DashboardTextKind.Known ||
      providerDraft.trim() === textValue(providerLabel),
  )
</script>

{#if isPasskeyProtection(protection)}
  <div class="space-y-5">
    <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <div>
        <dt class="access-micro-label text-muted-foreground">
          {vault.t(I18N_KEYS.DevicesAccessNookPasskeyName)}
        </dt>
        <dd class="mt-1.5 text-sm font-medium text-foreground">
          {knownText(passkeyName)
            ? textValue(passkeyName)
            : vault.t(I18N_KEYS.DevicesAccessPasskeyUnnamed)}
        </dd>
      </div>
      <div>
        <dt class="access-micro-label text-muted-foreground">
          {vault.t(I18N_KEYS.DevicesAccessCredentialId)}
        </dt>
        <dd
          class="mt-1.5 font-mono text-xs break-all text-foreground"
          data-testid="devices-access-credential-id"
        >
          {knownText(credentialId) ? textValue(credentialId) : unknown}
        </dd>
      </div>
      <div>
        <dt class="access-micro-label text-muted-foreground">
          {vault.t(I18N_KEYS.DevicesAccessLastSuccessfulUse)}
        </dt>
        <dd class="mt-1.5 text-sm text-foreground">
          {(() => { const labelRequest: Parameters<typeof lastUsedLabel>[0] = {
            vault,
            value: lastUsedAt,
          }; return lastUsedLabel(labelRequest); })()}
        </dd>
      </div>
      <div>
        <dt class="access-micro-label text-muted-foreground">
          {vault.t(I18N_KEYS.DevicesAccessKeeperLabel)}
        </dt>
        <dd
          class="mt-1.5 text-sm font-medium text-foreground"
          data-testid="devices-access-keeper"
        >
          {(() => { const keeperLabelArgs: Parameters<typeof keeperLabel>[0] = {
            vault,
            value: keeper,
          }; return keeperLabel(keeperLabelArgs); })()}
        </dd>
      </div>
      <div>
        <dt class="access-micro-label text-muted-foreground">
          {vault.t(I18N_KEYS.DevicesAccessCreated)}
        </dt>
        <dd class="mt-1.5 text-sm text-foreground">
          {createdAt.kind === DashboardTimestampKind.Known
            ? (() => { const dateRequest: Parameters<typeof formatAccessDate>[0] = {
                vault,
                value: createdAt.value,
              }; return formatAccessDate(dateRequest); })()
            : unknown}
        </dd>
      </div>
    </dl>

    <p class="text-xs leading-relaxed text-pretty text-muted-foreground">
      {(() => { const keeperStorageNoteArgs: Parameters<typeof keeperStorageNote>[0] = {
        vault,
        value: keeper,
      }; return keeperStorageNote(keeperStorageNoteArgs); })()}
    </p>

    <div class="border-t border-border/60 pt-5">
      <label
        for="devices-access-provider-label"
        class="access-micro-label text-muted-foreground"
      >
        {vault.t(I18N_KEYS.DevicesAccessWhereSaved)}
      </label>
      <div class="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="devices-access-provider-label"
          class="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          maxlength="80"
          placeholder={vault.t(I18N_KEYS.DevicesAccessWhereSavedPlaceholder)}
          bind:value={providerDraft}
          disabled={providerSaveState === ProviderSaveKind.Saving}
          oninput={onProviderDraftInput}
          data-testid="devices-access-provider-label"
        />
        <Button
          type="button"
          variant="outline"
          class="min-h-11"
          disabled={saveDisabled}
          data-testid="devices-access-provider-save"
          onclick={onSaveProviderLabel}
        >
          {#if providerSaveState === ProviderSaveKind.Saving}
            <RefreshCw class="size-4 animate-spin" />
          {:else}
            <Check class="size-4" />
          {/if}
          {vault.t(I18N_KEYS.CommonSave)}
        </Button>
      </div>
      <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessWhereSavedHelp)}
      </p>
      {#if providerSaveState === ProviderSaveKind.Failed}
        <p class="mt-1.5 text-xs text-destructive" role="alert">
          {vault.t(I18N_KEYS.DevicesAccessProviderSaveFailed)}
        </p>
      {/if}
    </div>

    <details class="border-t border-border/60 pt-1">
      <summary
        class="access-micro-label min-h-11 cursor-pointer list-none py-3 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-testid="devices-access-browser-reported"
      >
        {vault.t(I18N_KEYS.DevicesAccessBrowserReported)}
      </summary>
      <dl class="grid gap-x-6 gap-y-4 pb-1 sm:grid-cols-2">
        <div>
          <dt class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessAttachment)}
          </dt>
          <dd class="mt-1 text-sm text-foreground">
            {(() => { const labelRequest: Parameters<typeof attachmentLabel>[0] = {
              vault,
              value: attachment,
            }; return attachmentLabel(labelRequest); })()}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessBackupStatus)}
          </dt>
          <dd class="mt-1 text-sm text-foreground">
            {(() => { const labelRequest: Parameters<typeof backupLabel>[0] = {
              vault,
              value: backupState,
            }; return backupLabel(labelRequest); })()}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessTransports)}
          </dt>
          <dd class="mt-1 text-sm text-foreground">
            {(() => { const labelRequest: Parameters<typeof transportsLabel>[0] = {
              vault,
              values: transports,
            }; return transportsLabel(labelRequest); })()}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessLastClient)}
          </dt>
          <dd class="mt-1 text-sm text-foreground">
            {(() => { const labelRequest: Parameters<typeof clientEnvironmentLabel>[0] = {
              vault,
              browser: observedBrowser,
              platform: observedPlatform,
            }; return clientEnvironmentLabel(labelRequest); })()}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessAaguid)}
          </dt>
          <dd class="mt-1 font-mono text-xs break-all text-foreground">
            {knownText(aaguid) ? textValue(aaguid) : unknown}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessUserHandleId)}
          </dt>
          <dd class="mt-1 font-mono text-xs break-all text-foreground">
            {knownText(userHandleId) ? textValue(userHandleId) : unknown}
          </dd>
        </div>
      </dl>
    </details>

    <p
      class="rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
    >
      {recoveryNote}
    </p>
  </div>
{:else if protection === DeviceAccessProtectionKind.PinOrPassphrase}
  <p
    class="rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
  >
    {recoveryNote}
  </p>
{:else if protection === DeviceAccessProtectionKind.CompanionSession}
  <p
    class="rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
    data-testid="devices-access-companion-session"
  >
    {vault.t(I18N_KEYS.DevicesAccessThisBrowserCompanionDesc)}
  </p>
{/if}
