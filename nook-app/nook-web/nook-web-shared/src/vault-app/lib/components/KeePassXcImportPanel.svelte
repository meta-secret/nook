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
  messages={PASSWORD_IMPORT_MESSAGE_KEYS.KeePassXc}
  panelTestId="keepassxc-import-panel"
  fileTestId="keepassxc-csv-file"
  submitTestId="keepassxc-import-submit"
  errorTestId="keepassxc-import-error"
  resultTestId="keepassxc-import-result"
  accept=".csv,text/csv,application/csv"
  icon={PasswordImportIcon.Spreadsheet}
/>
