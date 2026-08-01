<script lang="ts">
  import { PASSWORD_IMPORT_MESSAGE_KEYS } from '../../../generated/i18n-keys'
  import PasswordManagerImportPanel from '$lib/components/PasswordManagerImportPanel.svelte'
  import type { ImportPanelProps } from '$lib/components/import-panel'
  import {
    PasswordImportFormat,
    PasswordImportIcon,
  } from './password-manager-import-state'

  let props: ImportPanelProps<Uint8Array> = $props()
</script>

<PasswordManagerImportPanel
  {...props}
  format={PasswordImportFormat.Binary}
  messages={PASSWORD_IMPORT_MESSAGE_KEYS.ProtonPass}
  panelTestId="proton-pass-import-panel"
  fileTestId="proton-pass-export-file"
  submitTestId="proton-pass-import-submit"
  errorTestId="proton-pass-import-error"
  resultTestId="proton-pass-import-result"
  accept=".zip,.json,application/zip,application/x-zip-compressed,application/json"
  icon={PasswordImportIcon.Archive}
/>
