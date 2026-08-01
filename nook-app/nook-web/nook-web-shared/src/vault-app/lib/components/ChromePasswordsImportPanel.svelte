<script lang="ts">
  import { PASSWORD_IMPORT_MESSAGE_KEYS } from '../../../generated/i18n-keys'
  import PasswordManagerImportPanel from '$lib/components/PasswordManagerImportPanel.svelte'
  import type { ImportPanelProps } from '$lib/components/import-panel'
  import {
    PasswordImportFormat,
    PasswordImportIcon,
  } from './password-manager-import-state'

  let props: ImportPanelProps<string> = $props()
</script>

<PasswordManagerImportPanel
  {...props}
  format={PasswordImportFormat.Text}
  messages={PASSWORD_IMPORT_MESSAGE_KEYS.ChromePasswords}
  panelTestId="chrome-passwords-import-panel"
  fileTestId="chrome-passwords-csv-file"
  submitTestId="chrome-passwords-import-submit"
  errorTestId="chrome-passwords-import-error"
  resultTestId="chrome-passwords-import-result"
  accept=".csv,text/csv"
  icon={PasswordImportIcon.Spreadsheet}
/>
