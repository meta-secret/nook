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
  translationPrefix="keepassxc_import"
  panelTestId="keepassxc-import-panel"
  fileTestId="keepassxc-csv-file"
  submitTestId="keepassxc-import-submit"
  errorTestId="keepassxc-import-error"
  resultTestId="keepassxc-import-result"
  accept=".csv,text/csv,application/csv"
  icon={PasswordImportIcon.Spreadsheet}
/>
