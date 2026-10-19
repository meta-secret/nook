<!--
All connections, in the panel: one companion keytag card per connected
identity with its vaults. Each vault shows what it does and is the default
for new logins or offers Make default; an identity other than the unlocked
one offers Use this identity, which locks this one and opens that one with
its own unlock. Back returns to This site.
-->
<script lang="ts">
  import { ArrowLeft, Check, FolderKey } from '@lucide/svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import type { ExtensionSessionDeviceState } from '../lib/nook-wasm'
  import type { PairedVaultGroup } from '../lib/paired-vaults'
  import {
    SidePanelIdentityRelation,
    SidePanelManageKind,
    SidePanelViews,
    type SidePanelManage,
  } from './side-panel-state'

  type SidePanelAllConnectionsProps = {
    readonly i18n: ExtensionI18n
    readonly groups: readonly PairedVaultGroup[]
    /** The unlocked key, which names the current identity. */
    readonly device: ExtensionSessionDeviceState
    readonly manage: SidePanelManage
    readonly onmakedefault: (vaultStoreId: string) => void
    readonly onuseidentity: (deviceId: string) => void
    readonly onback: () => void
  }

  let {
    i18n,
    groups,
    device,
    manage,
    onmakedefault,
    onuseidentity,
    onback,
  }: SidePanelAllConnectionsProps = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  const busy = $derived(manage.kind === SidePanelManageKind.Busy)

  function relation(group: PairedVaultGroup): SidePanelIdentityRelation {
    const request: Parameters<typeof SidePanelViews.identityRelation>[0] = {
      group,
      device,
    }
    return SidePanelViews.identityRelation(request)
  }
</script>

<section
  class="side-panel-section side-panel-all-connections"
  aria-labelledby="side-panel-all-connections-title"
  aria-busy={busy}
  data-testid="side-panel-all-connections"
>
  <div class="side-panel-all-connections-heading">
    <button
      type="button"
      class="side-panel-text-button side-panel-back"
      data-testid="side-panel-connections-back"
      onclick={onback}
    >
      <ArrowLeft size={14} aria-hidden="true" />
      {translatePlain(I18N_KEYS.ExtensionActionSiteLabel)}
    </button>
    <h1 id="side-panel-all-connections-title" class="side-panel-label">
      {translatePlain(I18N_KEYS.ExtensionCompanionVaultsTitle)}
    </h1>
    <p class="side-panel-note">
      {translatePlain(I18N_KEYS.ExtensionCompanionVaultsHint)}
    </p>
  </div>

  {#if manage.kind === SidePanelManageKind.Failed}
    <p class="error-message" role="alert" data-testid="side-panel-manage-error">
      {translatePlain(manage.key)}
    </p>
  {/if}

  {#each groups as group (`${group.deviceId}:${group.identityLabel}`)}
    {@const current = relation(group) === SidePanelIdentityRelation.Current}
    <article
      class="side-panel-keytag side-panel-identity-card"
      data-testid="side-panel-identity-card"
      data-current={current}
    >
      <div class="side-panel-keytag-body">
        <div class="side-panel-keytag-heading">
          <h2 class="side-panel-label side-panel-identity-name">
            {group.identityLabel ||
              translatePlain(I18N_KEYS.ExtensionCompanionOtherVaults)}
          </h2>
          {#if current}
            <span
              class="side-panel-state"
              data-state="unlocked"
              data-testid="side-panel-identity-state"
            >
              {translatePlain(I18N_KEYS.ExtensionActionStateUnlocked)}
            </span>
          {:else}
            <span
              class="side-panel-tag"
              data-testid="side-panel-identity-state"
            >
              {translatePlain(I18N_KEYS.ExtensionActionOtherIdentity)}
            </span>
          {/if}
        </div>
        <ul class="side-panel-vault-list">
          {#each group.vaults as vault (vault.vaultStoreId)}
            <li
              class="side-panel-vault-row"
              class:is-default={vault.isDefault}
              data-testid="side-panel-vault"
              data-vault-store-id={vault.vaultStoreId}
            >
              <span class="side-panel-vault-icon" aria-hidden="true">
                <FolderKey size={14} />
              </span>
              <span class="side-panel-vault-copy">
                <span class="side-panel-vault-name">
                  {vault.vaultName ||
                    translatePlain(I18N_KEYS.LoginVaultPickerUnnamed)}
                </span>
                <span class="side-panel-vault-meta">
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
                </span>
              </span>
              {#if vault.isDefault}
                <span
                  class="side-panel-vault-default"
                  title={translatePlain(
                    I18N_KEYS.ExtensionCompanionDefaultVaultHint,
                  )}
                  data-testid="side-panel-default-vault"
                >
                  <Check size={12} aria-hidden="true" />
                  {translatePlain(I18N_KEYS.ExtensionCompanionDefaultVault)}
                </span>
              {:else}
                <button
                  type="button"
                  class="side-panel-vault-make-default"
                  title={translatePlain(
                    I18N_KEYS.ExtensionCompanionDefaultVaultHint,
                  )}
                  aria-disabled={busy}
                  data-testid="side-panel-make-default"
                  onclick={() => onmakedefault(vault.vaultStoreId)}
                >
                  {translatePlain(I18N_KEYS.ExtensionCompanionMakeDefault)}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
      {#if !current}
        <div class="side-panel-action-bar">
          <button
            type="button"
            aria-disabled={busy}
            data-testid="side-panel-use-identity"
            onclick={() => onuseidentity(group.deviceId)}
          >
            {translatePlain(I18N_KEYS.ExtensionCompanionUseIdentity)}
          </button>
        </div>
      {/if}
    </article>
  {/each}
</section>
