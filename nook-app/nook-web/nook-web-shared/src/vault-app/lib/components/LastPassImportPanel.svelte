<script lang="ts">
  import PasswordManagerImportPanel from '$lib/components/PasswordManagerImportPanel.svelte'
  import type { ImportPanelProps } from '$lib/components/import-panel'

  let props: ImportPanelProps<string> = $props()
</script>

<PasswordManagerImportPanel
  {...props}
  format="text"
  translationPrefix="lastpass_import"
  panelTestId="lastpass-import-panel"
  fileTestId="lastpass-csv-file"
  submitTestId="lastpass-import-submit"
  errorTestId="lastpass-import-error"
  resultTestId="lastpass-import-result"
  accept=".csv,text/csv,application/csv"
  icon="spreadsheet"
/>
