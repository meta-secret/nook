<script lang="ts">
  import PasswordManagerImportPanel from '$lib/components/PasswordManagerImportPanel.svelte'
  import type { ImportPanelProps } from '$lib/components/import-panel'

  let props: ImportPanelProps<string> = $props()
</script>

<PasswordManagerImportPanel
  {...props}
  format="text"
  translationPrefix="chrome_passwords_import"
  panelTestId="chrome-passwords-import-panel"
  fileTestId="chrome-passwords-csv-file"
  submitTestId="chrome-passwords-import-submit"
  errorTestId="chrome-passwords-import-error"
  resultTestId="chrome-passwords-import-result"
  accept=".csv,text/csv"
  icon="spreadsheet"
/>
