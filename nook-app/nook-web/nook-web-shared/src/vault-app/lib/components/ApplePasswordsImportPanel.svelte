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
  translationPrefix="apple_passwords_import"
  panelTestId="apple-passwords-import-panel"
  fileTestId="apple-passwords-csv-file"
  submitTestId="apple-passwords-import-submit"
  errorTestId="apple-passwords-import-error"
  resultTestId="apple-passwords-import-result"
  accept=".csv,text/csv"
  icon={PasswordImportIcon.Spreadsheet}
/>
