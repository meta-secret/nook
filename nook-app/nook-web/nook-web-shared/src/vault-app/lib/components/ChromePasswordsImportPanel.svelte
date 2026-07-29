<script lang="ts">
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
  translationPrefix="chrome_passwords_import"
  panelTestId="chrome-passwords-import-panel"
  fileTestId="chrome-passwords-csv-file"
  submitTestId="chrome-passwords-import-submit"
  errorTestId="chrome-passwords-import-error"
  resultTestId="chrome-passwords-import-result"
  accept=".csv,text/csv"
  icon={PasswordImportIcon.Spreadsheet}
/>
