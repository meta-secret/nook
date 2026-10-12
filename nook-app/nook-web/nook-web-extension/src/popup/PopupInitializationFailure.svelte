<script lang="ts">
  import type { ExtensionI18n } from '../lib/i18n'
  import { extensionLocaleCatalog } from '../lib/i18n'
  import {
    popupInitializationFailureKey,
    type PopupInitializationPhase,
  } from './popup-app-state'
  let {
    i18n,
    phase,
  }: { i18n: ExtensionI18n; phase: PopupInitializationPhase } = $props()
</script>

<main class="companion-page">
  <p class="error" role="alert">
    {i18n.t(
      extensionLocaleCatalog.plainExtensionTranslation(
        popupInitializationFailureKey(phase),
      ),
    )}
  </p>
</main>
