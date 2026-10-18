<!--
What the identity check after an unlock found: still checking, vaults that
wait for a grant, or a failed check. It shows wherever the unlocked panel
shows its identity:vault sections or says none is connected, so a failure is
never silent.
-->
<script lang="ts">
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
  import { IdentitySyncKind, type IdentitySync } from '../popup/popup-app-state'

  type SidePanelIdentitySyncProps = {
    readonly i18n: ExtensionI18n
    readonly identitySync: IdentitySync
  }

  let { i18n, identitySync }: SidePanelIdentitySyncProps = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  function awaitingNote(awaitingGrant: number): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionCompanionIdentitySyncAwaiting,
      replacements: { count: String(awaitingGrant) },
    }
    return i18n.t(request)
  }
</script>

{#if identitySync.kind === IdentitySyncKind.Checking}
  <p class="side-panel-note" role="status" data-testid="side-panel-sync">
    {translatePlain(I18N_KEYS.ExtensionCompanionIdentitySyncChecking)}
  </p>
{:else if identitySync.kind === IdentitySyncKind.Checked && identitySync.awaitingGrant > 0}
  <p class="side-panel-note" data-testid="side-panel-sync">
    {awaitingNote(identitySync.awaitingGrant)}
  </p>
{:else if identitySync.kind === IdentitySyncKind.Failed}
  <p class="error-message" role="alert" data-testid="side-panel-sync">
    {translatePlain(I18N_KEYS.ExtensionCompanionIdentitySyncFailed)}
  </p>
{/if}
