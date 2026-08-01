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
  messages={PASSWORD_IMPORT_MESSAGE_KEYS.Keeper}
  panelTestId="keeper-import-panel"
  fileTestId="keeper-csv-file"
  submitTestId="keeper-import-submit"
  errorTestId="keeper-import-error"
  resultTestId="keeper-import-result"
  accept=".csv,text/csv,application/csv"
  icon={PasswordImportIcon.Spreadsheet}
/>
