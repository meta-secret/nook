<script lang="ts">
  import PasswordManagerImportPanel from '$lib/components/PasswordManagerImportPanel.svelte'
  import type { ImportPanelProps } from '$lib/components/import-panel'

  let props: ImportPanelProps<string> = $props()
</script>

<PasswordManagerImportPanel
  {...props}
  format="text"
  translationPrefix="apple_passwords_import"
  panelTestId="apple-passwords-import-panel"
  fileTestId="apple-passwords-csv-file"
  submitTestId="apple-passwords-import-submit"
  errorTestId="apple-passwords-import-error"
  resultTestId="apple-passwords-import-result"
  accept=".csv,text/csv"
  icon="spreadsheet"
/>
