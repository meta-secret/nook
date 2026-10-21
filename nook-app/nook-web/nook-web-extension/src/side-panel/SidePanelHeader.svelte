<!--
The side panel's header band, as the companion card's: the Nook mark, the
Browser companion label and the state tag; Open vault as a quiet link (an
icon button below 380px), Refresh, which reads everything again, and, once
unlocked, Lock. Opening the vault never closes the panel.
-->
<script lang="ts">
  import { ArrowUpRight, FolderOpen, Lock, RotateCw } from '@lucide/svelte'
  import NookIcon from '../../../nook-web-shared/src/components/NookIcon.svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import {
    SidePanelChipKind,
    SidePanelHeaderActionKind,
    SidePanelSessionControls,
    type SidePanelChip,
  } from './side-panel-state'

  type SidePanelHeaderProps = {
    readonly i18n: ExtensionI18n
    readonly chip: SidePanelChip
    readonly controls: SidePanelSessionControls
    readonly action: SidePanelHeaderActionKind
    readonly onopenvault: () => void
    readonly onrefresh: () => void
    readonly onlock: () => void
  }

  let {
    i18n,
    chip,
    controls,
    action,
    onopenvault,
    onrefresh,
    onlock,
  }: SidePanelHeaderProps = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  const busy = $derived(action !== SidePanelHeaderActionKind.Idle)
</script>

<header class="side-panel-band">
  <div class="side-panel-brand">
    <NookIcon src="../icons/nook.png" alt="" class="side-panel-mark" />
    <div class="side-panel-brand-copy">
      <span class="side-panel-brand-name">
        {translatePlain(I18N_KEYS.ExtensionCompanionStepLabel)}
      </span>
      {#if chip.kind === SidePanelChipKind.Shown}
        <p
          class="side-panel-state"
          data-state={chip.state}
          aria-live="polite"
          data-testid="side-panel-state"
        >
          {translatePlain(chip.label)}
        </p>
      {/if}
    </div>
  </div>
  <div class="side-panel-actions">
    <button
      type="button"
      class="side-panel-text-button side-panel-open-vault"
      title={translatePlain(I18N_KEYS.ExtensionActionOpenVault)}
      aria-describedby="side-panel-opens-new-tab"
      aria-busy={action === SidePanelHeaderActionKind.OpeningVault}
      aria-disabled={busy}
      data-testid="side-panel-open-vault"
      onclick={onopenvault}
    >
      <FolderOpen
        size={16}
        class="side-panel-open-vault-icon"
        aria-hidden="true"
      />
      <span class="side-panel-open-vault-label">
        {translatePlain(I18N_KEYS.ExtensionActionOpenVault)}
      </span>
      <ArrowUpRight
        size={14}
        class="side-panel-open-vault-arrow"
        aria-hidden="true"
      />
    </button>
    <button
      type="button"
      class="side-panel-icon-button"
      aria-label={translatePlain(I18N_KEYS.ExtensionActionRefresh)}
      title={translatePlain(I18N_KEYS.ExtensionActionRefresh)}
      aria-disabled={busy}
      data-testid="side-panel-refresh"
      onclick={onrefresh}
    >
      <RotateCw size={16} aria-hidden="true" />
    </button>
    {#if controls === SidePanelSessionControls.Shown}
      <button
        type="button"
        class="side-panel-icon-button"
        aria-label={translatePlain(I18N_KEYS.ExtensionActionLock)}
        title={translatePlain(I18N_KEYS.ExtensionActionLock)}
        aria-busy={action === SidePanelHeaderActionKind.Locking}
        aria-disabled={busy}
        data-testid="side-panel-lock"
        onclick={onlock}
      >
        <Lock size={16} aria-hidden="true" />
      </button>
    {/if}
  </div>
  <span id="side-panel-opens-new-tab" class="side-panel-sr-only">
    {translatePlain(I18N_KEYS.ExtensionActionOpensNewTab)}
  </span>
</header>
