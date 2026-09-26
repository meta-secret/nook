<script lang="ts">
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import {
    type ExtensionI18n,
    extensionLocaleCatalog,
  } from '../lib/i18n'

  let { i18n }: { i18n: ExtensionI18n } = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }
</script>

<main class="device-setup" data-testid="extension-device-setup">
  <h1>{translatePlain(I18N_KEYS.DeviceProtectionTitle)}</h1>
  <p class="error-message" role="alert" data-testid="extension-runtime-error">
    {translatePlain(I18N_KEYS.ErrorsEngineUnavailable)}
  </p>
</main>
