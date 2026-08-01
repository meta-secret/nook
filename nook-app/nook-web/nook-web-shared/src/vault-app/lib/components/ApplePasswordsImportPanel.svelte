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
  messages={PASSWORD_IMPORT_MESSAGE_KEYS.ApplePasswords}
  panelTestId="apple-passwords-import-panel"
  fileTestId="apple-passwords-csv-file"
  submitTestId="apple-passwords-import-submit"
  errorTestId="apple-passwords-import-error"
  resultTestId="apple-passwords-import-result"
  accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
  icon={PasswordImportIcon.Archive}
/>
